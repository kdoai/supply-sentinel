targetScope = 'resourceGroup'

@description('Short lowercase prefix used for globally unique resource names.')
param appName string = 'supplysentinel'

@description('Azure region. Japan East is the default for the hackathon demo.')
param location string = resourceGroup().location

@description('Timer schedule in NCRONTAB format. Default is every 6 hours.')
param timerSchedule string = '0 0 */6 * * *'

@description('Runtime mode. demo keeps deterministic sample data; cloud enables external Azure AI settings when configured.')
@allowed([
  'demo'
  'cloud'
])
param runMode string = 'demo'

@description('Optional GitHub Actions service principal objectId. If provided, upload/deploy RBAC is assigned without secrets.')
param githubPrincipalId string = ''

@description('Optional Azure OpenAI endpoint from Azure AI Foundry. Leave empty for low-cost demo mode.')
param azureOpenAiEndpoint string = ''

@description('Optional Azure OpenAI deployment name, for example gpt-4o-mini.')
param azureOpenAiDeployment string = 'gpt-4o-mini'

var suffix = toLower(uniqueString(resourceGroup().id, appName))
var functionStorageName = take('${appName}func${suffix}', 24)
var webStorageName = take('${appName}web${suffix}', 24)
var functionAppName = take('${appName}-func-${suffix}', 60)
var planName = '${appName}-plan'
var cosmosName = take('${appName}-cosmos-${suffix}', 44)
var databaseName = 'supply-sentinel'
var containerName = 'runs'
var hasGithubPrincipal = !empty(githubPrincipalId)

resource functionStorage 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: functionStorageName
  location: location
  sku: {
    name: 'Standard_LRS'
  }
  kind: 'StorageV2'
  properties: {
    supportsHttpsTrafficOnly: true
    minimumTlsVersion: 'TLS1_2'
    allowBlobPublicAccess: false
  }
}

resource webStorage 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: webStorageName
  location: location
  sku: {
    name: 'Standard_LRS'
  }
  kind: 'StorageV2'
  properties: {
    supportsHttpsTrafficOnly: true
    minimumTlsVersion: 'TLS1_2'
    allowSharedKeyAccess: false
    allowBlobPublicAccess: true
  }
}

resource plan 'Microsoft.Web/serverfarms@2023-12-01' = {
  name: planName
  location: location
  sku: {
    name: 'Y1'
    tier: 'Dynamic'
  }
}

resource cosmos 'Microsoft.DocumentDB/databaseAccounts@2024-05-15' = {
  name: cosmosName
  location: location
  kind: 'GlobalDocumentDB'
  properties: {
    databaseAccountOfferType: 'Standard'
    capabilities: [
      {
        name: 'EnableServerless'
      }
    ]
    consistencyPolicy: {
      defaultConsistencyLevel: 'Session'
    }
    disableLocalAuth: true
    minimalTlsVersion: 'Tls12'
    publicNetworkAccess: 'Enabled'
    locations: [
      {
        locationName: location
        failoverPriority: 0
        isZoneRedundant: false
      }
    ]
  }
}

resource database 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases@2024-05-15' = {
  name: databaseName
  parent: cosmos
  properties: {
    resource: {
      id: databaseName
    }
  }
}

resource container 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers@2024-05-15' = {
  name: containerName
  parent: database
  properties: {
    resource: {
      id: containerName
      partitionKey: {
        paths: [
          '/pk'
        ]
        kind: 'Hash'
      }
      indexingPolicy: {
        indexingMode: 'consistent'
        automatic: true
        includedPaths: [
          {
            path: '/*'
          }
        ]
        excludedPaths: [
          {
            path: '/"_etag"/?'
          }
        ]
      }
    }
  }
}

resource functionApp 'Microsoft.Web/sites@2023-12-01' = {
  name: functionAppName
  location: location
  kind: 'functionapp'
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    serverFarmId: plan.id
    httpsOnly: true
    siteConfig: {
      ftpsState: 'Disabled'
      minTlsVersion: '1.2'
      cors: {
        allowedOrigins: [
          '*'
        ]
        supportCredentials: false
      }
      appSettings: [
        {
          name: 'AzureWebJobsStorage'
          value: 'DefaultEndpointsProtocol=https;AccountName=${functionStorage.name};AccountKey=${listKeys(functionStorage.id, functionStorage.apiVersion).keys[0].value};EndpointSuffix=${environment().suffixes.storage}'
        }
        {
          name: 'FUNCTIONS_EXTENSION_VERSION'
          value: '~4'
        }
        {
          name: 'FUNCTIONS_WORKER_RUNTIME'
          value: 'node'
        }
        {
          name: 'WEBSITE_NODE_DEFAULT_VERSION'
          value: '~20'
        }
        {
          name: 'WEBSITE_RUN_FROM_PACKAGE'
          value: '1'
        }
        {
          name: 'RUN_MODE'
          value: runMode
        }
        {
          name: 'SUPPLY_SENTINEL_TIMER_SCHEDULE'
          value: timerSchedule
        }
        {
          name: 'SUPPLY_SENTINEL_STATE_STORE'
          value: 'cosmos'
        }
        {
          name: 'COSMOS_DB_ENDPOINT'
          value: cosmos.properties.documentEndpoint
        }
        {
          name: 'COSMOS_DB_DATABASE'
          value: databaseName
        }
        {
          name: 'COSMOS_DB_CONTAINER'
          value: containerName
        }
        {
          name: 'COSMOS_DB_USE_AAD'
          value: 'true'
        }
        {
          name: 'AZURE_OPENAI_ENDPOINT'
          value: azureOpenAiEndpoint
        }
        {
          name: 'AZURE_OPENAI_DEPLOYMENT'
          value: azureOpenAiDeployment
        }
        {
          name: 'AZURE_OPENAI_USE_AAD'
          value: 'true'
        }
      ]
    }
  }
}

resource cosmosDataContributor 'Microsoft.DocumentDB/databaseAccounts/sqlRoleAssignments@2024-05-15' = {
  name: guid(cosmos.id, functionApp.name, 'cosmos-data-contributor')
  parent: cosmos
  properties: {
    principalId: functionApp.identity.principalId
    roleDefinitionId: '${cosmos.id}/sqlRoleDefinitions/00000000-0000-0000-0000-000000000002'
    scope: cosmos.id
  }
}

resource githubStorageContributor 'Microsoft.Authorization/roleAssignments@2022-04-01' = if (hasGithubPrincipal) {
  name: guid(resourceGroup().id, githubPrincipalId, 'storage-blob-data-contributor')
  scope: webStorage
  properties: {
    principalId: githubPrincipalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', 'ba92f5b4-2d11-453d-a403-e96b0029c9fe')
  }
}

output functionAppName string = functionApp.name
output functionApiBase string = 'https://${functionApp.properties.defaultHostName}'
output staticStorageAccountName string = webStorage.name
output staticWebsiteUrl string = webStorage.properties.primaryEndpoints.web
output cosmosAccountName string = cosmos.name
output resourceGroupName string = resourceGroup().name
