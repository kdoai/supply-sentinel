targetScope = 'resourceGroup'

@description('Short lowercase prefix used for globally unique resource names.')
param appName string = 'supplysentinel'

@description('Azure region.')
param location string = resourceGroup().location

@description('Container Apps Job schedule. Default is every 6 hours.')
param timerCron string = '0 */6 * * *'

@description('Runtime mode. demo keeps deterministic sample data; cloud enables external Azure AI settings when configured.')
@allowed([
  'demo'
  'cloud'
])
param runMode string = 'demo'

@description('Optional GitHub Actions service principal objectId. If provided, CI/CD RBAC is assigned without secrets.')
param githubPrincipalId string = ''

@description('Container image for the API and scheduled agent. CI updates this after pushing to ACR.')
param containerImage string = 'mcr.microsoft.com/azuredocs/containerapps-helloworld:latest'

@description('Optional Azure OpenAI endpoint from Azure AI Foundry. Leave empty for low-cost demo mode.')
param azureOpenAiEndpoint string = ''

@description('Optional Azure OpenAI deployment name, for example gpt-4o-mini.')
param azureOpenAiDeployment string = 'gpt-4o-mini'

var suffix = toLower(uniqueString(resourceGroup().id, appName))
var webStorageName = take('${appName}web${suffix}', 24)
var acrName = take('${appName}acr${suffix}', 50)
var cosmosName = take('${appName}-cosmos-${suffix}', 44)
var logName = '${appName}-logs-${suffix}'
var envName = '${appName}-env-${suffix}'
var identityName = '${appName}-runtime-${suffix}'
var appContainerName = '${appName}-api'
var jobName = '${appName}-agent-job'
var databaseName = 'supply-sentinel'
var containerName = 'runs'
var hasGithubPrincipal = !empty(githubPrincipalId)
var isAcrImage = startsWith(containerImage, '${acrName}.azurecr.io/')

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

resource acr 'Microsoft.ContainerRegistry/registries@2023-07-01' = {
  name: acrName
  location: location
  sku: {
    name: 'Basic'
  }
  properties: {
    adminUserEnabled: false
    publicNetworkAccess: 'Enabled'
    policies: {
      quarantinePolicy: {
        status: 'disabled'
      }
      retentionPolicy: {
        days: 7
        status: 'enabled'
      }
    }
  }
}

resource logs 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: logName
  location: location
  properties: {
    sku: {
      name: 'PerGB2018'
    }
    retentionInDays: 30
    publicNetworkAccessForIngestion: 'Enabled'
    publicNetworkAccessForQuery: 'Enabled'
  }
}

resource managedEnv 'Microsoft.App/managedEnvironments@2024-03-01' = {
  name: envName
  location: location
  properties: {
    appLogsConfiguration: {
      destination: 'log-analytics'
      logAnalyticsConfiguration: {
        customerId: logs.properties.customerId
        sharedKey: logs.listKeys().primarySharedKey
      }
    }
  }
}

resource runtimeIdentity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: identityName
  location: location
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

resource runtimeAcrPull 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(acr.id, runtimeIdentity.name, 'acrpull')
  scope: acr
  properties: {
    principalId: runtimeIdentity.properties.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '7f951dda-4ed3-4680-a7ca-43fe172d538d')
  }
}

resource runtimeCosmosDataContributor 'Microsoft.DocumentDB/databaseAccounts/sqlRoleAssignments@2024-05-15' = {
  name: guid(cosmos.id, runtimeIdentity.name, 'cosmos-data-contributor')
  parent: cosmos
  properties: {
    principalId: runtimeIdentity.properties.principalId
    roleDefinitionId: '${cosmos.id}/sqlRoleDefinitions/00000000-0000-0000-0000-000000000002'
    scope: cosmos.id
  }
}

resource githubAcrPush 'Microsoft.Authorization/roleAssignments@2022-04-01' = if (hasGithubPrincipal) {
  name: guid(acr.id, githubPrincipalId, 'acrpush')
  scope: acr
  properties: {
    principalId: githubPrincipalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '8311e382-0749-4cb8-b61a-304f252e45ec')
  }
}

resource githubStorageContributor 'Microsoft.Authorization/roleAssignments@2022-04-01' = if (hasGithubPrincipal) {
  name: guid(webStorage.id, githubPrincipalId, 'storage-blob-data-contributor')
  scope: webStorage
  properties: {
    principalId: githubPrincipalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', 'ba92f5b4-2d11-453d-a403-e96b0029c9fe')
  }
}

var appEnv = [
  {
    name: 'RUN_MODE'
    value: runMode
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
    name: 'AZURE_CLIENT_ID'
    value: runtimeIdentity.properties.clientId
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
  {
    name: 'HOST'
    value: '0.0.0.0'
  }
  {
    name: 'PORT'
    value: '4173'
  }
]

resource apiApp 'Microsoft.App/containerApps@2024-03-01' = {
  name: appContainerName
  location: location
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: {
      '${runtimeIdentity.id}': {}
    }
  }
  properties: {
    environmentId: managedEnv.id
    configuration: {
      activeRevisionsMode: 'Single'
      ingress: {
        external: true
        targetPort: 4173
        allowInsecure: false
        transport: 'auto'
      }
      registries: isAcrImage ? [
        {
          server: acr.properties.loginServer
          identity: runtimeIdentity.id
        }
      ] : []
    }
    template: {
      containers: [
        {
          name: 'api'
          image: containerImage
          env: appEnv
          resources: {
            cpu: json('0.25')
            memory: '0.5Gi'
          }
        }
      ]
      scale: {
        minReplicas: 0
        maxReplicas: 1
      }
    }
  }
  dependsOn: [
    runtimeAcrPull
    runtimeCosmosDataContributor
  ]
}

resource agentJob 'Microsoft.App/jobs@2024-03-01' = {
  name: jobName
  location: location
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: {
      '${runtimeIdentity.id}': {}
    }
  }
  properties: {
    environmentId: managedEnv.id
    configuration: {
      triggerType: 'Schedule'
      replicaTimeout: 600
      replicaRetryLimit: 1
      scheduleTriggerConfig: {
        cronExpression: timerCron
        parallelism: 1
        replicaCompletionCount: 1
      }
      registries: isAcrImage ? [
        {
          server: acr.properties.loginServer
          identity: runtimeIdentity.id
        }
      ] : []
    }
    template: {
      containers: [
        {
          name: 'agent'
          image: containerImage
          command: [
            'node'
            'src/run-demo.mjs'
          ]
          env: appEnv
          resources: {
            cpu: json('0.25')
            memory: '0.5Gi'
          }
        }
      ]
    }
  }
  dependsOn: [
    runtimeAcrPull
    runtimeCosmosDataContributor
  ]
}

output acrName string = acr.name
output acrLoginServer string = acr.properties.loginServer
output containerAppName string = apiApp.name
output containerJobName string = agentJob.name
output containerAppFqdn string = apiApp.properties.configuration.ingress.fqdn
output functionAppName string = ''
output functionApiBase string = 'https://${apiApp.properties.configuration.ingress.fqdn}'
output staticStorageAccountName string = webStorage.name
output staticWebsiteUrl string = webStorage.properties.primaryEndpoints.web
output cosmosAccountName string = cosmos.name
output resourceGroupName string = resourceGroup().name
