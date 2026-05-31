param(
  [Parameter(Mandatory = $true)]
  [string]$SubscriptionId,

  [string]$Repository = "kdoai/supply-sentinel",
  [string]$ResourceGroup = "rg-supply-sentinel-demo",
  [string]$Location = "japaneast",
  [string]$AppName = "supplysentinel",
  [string]$EnvironmentName = "azure-demo",
  [int]$MonthlyBudgetYen = 3000
)

$ErrorActionPreference = "Stop"

function Resolve-Tool($Name, [string[]]$FallbackPaths) {
  $command = Get-Command $Name -ErrorAction SilentlyContinue
  if ($command) {
    return $command.Source
  }

  foreach ($candidate in $FallbackPaths) {
    if (Test-Path -LiteralPath $candidate) {
      return $candidate
    }
  }

  throw "$Name is not available. Open a new terminal or install it first."
}

$script:AzCli = Resolve-Tool "az" @(
  "C:\Program Files\Microsoft SDKs\Azure\CLI2\wbin\az.cmd"
)
$script:GhCli = Resolve-Tool "gh" @(
  "C:\Program Files\GitHub CLI\gh.exe",
  "C:\tmp\gh-cli\bin\gh.exe"
)

function az {
  & $script:AzCli @Args
}

function gh {
  & $script:GhCli @Args
}

$account = az account show --query "{tenantId:tenantId,user:user.name}" -o json | ConvertFrom-Json
if (-not $account) {
  throw "Azure CLI is not logged in. Run az login first."
}

az account set --subscription $SubscriptionId
$tenantId = az account show --query tenantId -o tsv

Write-Host "Creating resource group $ResourceGroup in $Location..."
az group create --name $ResourceGroup --location $Location --tags project=SupplySentinel environment=hackathon costTargetYen=$MonthlyBudgetYen | Out-Null

Write-Host "Registering required Azure resource providers..."
az provider register --namespace Microsoft.App --wait | Out-Null
az provider register --namespace Microsoft.ContainerRegistry --wait | Out-Null
az provider register --namespace Microsoft.OperationalInsights --wait | Out-Null
az provider register --namespace Microsoft.DocumentDB --wait | Out-Null
az provider register --namespace Microsoft.Storage --wait | Out-Null

$displayName = "$AppName-github-oidc"
$appId = az ad app list --display-name $displayName --query "[0].appId" -o tsv
if (-not $appId) {
  Write-Host "Creating Entra app registration $displayName..."
  $appId = az ad app create --display-name $displayName --query appId -o tsv
}

$spObjectId = az ad sp list --filter "appId eq '$appId'" --query "[0].id" -o tsv
if (-not $spObjectId) {
  Write-Host "Creating service principal..."
  $spObjectId = az ad sp create --id $appId --query id -o tsv
}

$repoParts = $Repository.Split("/")
if ($repoParts.Count -ne 2) {
  throw "Repository must be owner/name, for example kdoai/supply-sentinel."
}

$federatedName = "github-$($repoParts[0])-$($repoParts[1])-$EnvironmentName"
$subject = "repo:$Repository:environment:$EnvironmentName"
$existingFederated = az ad app federated-credential list --id $appId --query "[?name=='$federatedName'].name | [0]" -o tsv
if (-not $existingFederated) {
  $credential = @{
    name = $federatedName
    issuer = "https://token.actions.githubusercontent.com"
    subject = $subject
    audiences = @("api://AzureADTokenExchange")
  } | ConvertTo-Json -Depth 5
  $tempFile = New-TemporaryFile
  Set-Content -Path $tempFile -Value $credential -Encoding utf8
  try {
    Write-Host "Creating GitHub OIDC federated credential..."
    az ad app federated-credential create --id $appId --parameters "@$tempFile" | Out-Null
  } finally {
    Remove-Item -LiteralPath $tempFile -Force
  }
}

$scope = "/subscriptions/$SubscriptionId/resourceGroups/$ResourceGroup"
Write-Host "Assigning least practical roles scoped to $ResourceGroup..."
az role assignment create --assignee-object-id $spObjectId --assignee-principal-type ServicePrincipal --role Contributor --scope $scope 2>$null | Out-Null
az role assignment create --assignee-object-id $spObjectId --assignee-principal-type ServicePrincipal --role "Role Based Access Control Administrator" --scope $scope 2>$null | Out-Null
az role assignment create --assignee-object-id $spObjectId --assignee-principal-type ServicePrincipal --role "Storage Blob Data Contributor" --scope $scope 2>$null | Out-Null
az role assignment create --assignee-object-id $spObjectId --assignee-principal-type ServicePrincipal --role AcrPush --scope $scope 2>$null | Out-Null

Write-Host "Writing GitHub OIDC secrets and deployment variables..."
gh secret set AZURE_CLIENT_ID --repo $Repository --body $appId
gh secret set AZURE_TENANT_ID --repo $Repository --body $tenantId
gh secret set AZURE_SUBSCRIPTION_ID --repo $Repository --body $SubscriptionId
gh variable set AZURE_RESOURCE_GROUP --repo $Repository --body $ResourceGroup
gh variable set AZURE_LOCATION --repo $Repository --body $Location
gh variable set AZURE_APP_NAME --repo $Repository --body $AppName
gh variable set AZURE_GITHUB_PRINCIPAL_ID --repo $Repository --body $spObjectId

Write-Host "Deploying base Azure resources..."
az deployment group create `
  --name supply-sentinel-cloud `
  --resource-group $ResourceGroup `
  --template-file infra/main.bicep `
  --parameters appName=$AppName location=$Location runMode=demo `
  --query "properties.outputs" `
  -o json

Write-Host ""
Write-Host "Bootstrap complete. Run this GitHub Actions workflow next:"
Write-Host "gh workflow run deploy-azure.yml -R $Repository -f run_mode=demo"
