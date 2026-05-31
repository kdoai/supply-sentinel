using './main.bicep'

param appName = 'supplysentinel'
param location = 'japaneast'
param timerCron = '0 */6 * * *'
param runMode = 'demo'
param azureOpenAiDeployment = 'gpt-5.4'
param azureOpenAiSubagentDeployment = 'gpt-5.4-mini'
