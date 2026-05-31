using './main.bicep'

param appName = 'supplysentinel'
param location = 'japaneast'
param timerSchedule = '0 0 */6 * * *'
param runMode = 'demo'
param azureOpenAiDeployment = 'gpt-4o-mini'
