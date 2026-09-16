targetScope = 'resourceGroup'
param location string = resourceGroup().location
param postgresLocation string = location
@minLength(3)
@maxLength(35)
param appName string
param tenantId string = 'a72c5ca4-2803-4603-b2ed-1d4e1a6db4f2'
param authClientId string
@secure()
param authClientSecret string
@secure()
param databasePassword string

var auth = {
  platform: { enabled: true }
  globalValidation: {
    requireAuthentication: true
    unauthenticatedClientAction: 'RedirectToLoginPage'
    redirectToProvider: 'azureactivedirectory'
    excludedPaths: ['/api/health']
  }
  identityProviders: {
    azureActiveDirectory: {
      enabled: true
      registration: {
        openIdIssuer: '${environment().authentication.loginEndpoint}${tenantId}/v2.0'
        clientId: authClientId
        clientSecretSettingName: 'MICROSOFT_PROVIDER_AUTHENTICATION_SECRET'
      }
      validation: { allowedAudiences: [authClientId] }
    }
  }
  login: { tokenStore: { enabled: true } }
  httpSettings: { requireHttps: true }
}
resource plan 'Microsoft.Web/serverfarms@2024-11-01' = {
  name: '${appName}-free'
  location: location
  kind: 'linux'
  sku: {name: 'F1', tier: 'Free', capacity: 1}
  properties: {reserved: true}
}
resource app 'Microsoft.Web/sites@2024-11-01' = {
  name: appName
  location: location
  kind: 'app,linux'
  identity: {type: 'SystemAssigned'}
  properties: {
    serverFarmId: plan.id
    httpsOnly: true
    // Delivery workflow starts the app for verified package deployment.
    enabled: false
    siteConfig: {
      linuxFxVersion: 'NODE|24-lts'
      appCommandLine: 'node launch.mjs'
      alwaysOn: false
      healthCheckPath: '/api/health'
      ftpsState: 'Disabled'
      minTlsVersion: '1.2'
      scmMinTlsVersion: '1.2'
      appSettings: [
        {name: 'NODE_ENV', value: 'production'}
        {name: 'SCM_DO_BUILD_DURING_DEPLOYMENT', value: 'false'}
        {name: 'WEBSITE_RUN_FROM_PACKAGE', value: '1'}
        {name: 'CHANGEGUARD_AUTH', value: 'azure-easyauth'}
        {name: 'AZURE_TENANT_ID', value: tenantId}
        {name: 'APP_ORIGIN', value: 'https://${appName}.azurewebsites.net'}
        {name: 'MICROSOFT_PROVIDER_AUTHENTICATION_SECRET', value: authClientSecret}
        {name: 'PGHOST', value: '${appName}-pg.postgres.database.azure.com'}
        {name: 'PGDATABASE', value: 'changeguard'}
        {name: 'PGUSER', value: 'cgadmin'}
        {name: 'PGPASSWORD', value: databasePassword}
        {name: 'PGSSLMODE', value: 'verify-full'}
      ]
    }
  }
}
resource scmPolicy 'Microsoft.Web/sites/basicPublishingCredentialsPolicies@2024-11-01' = {
  parent: app
  name: 'scm'
  properties: {allow: false}
}
resource ftpPolicy 'Microsoft.Web/sites/basicPublishingCredentialsPolicies@2024-11-01' = {
  parent: app
  name: 'ftp'
  properties: {allow: false}
}
resource authentication 'Microsoft.Web/sites/config@2024-11-01' = {
  parent: app
  name: 'authsettingsV2'
  properties: auth
}
resource postgres 'Microsoft.DBforPostgreSQL/flexibleServers@2024-08-01' = {
  name: '${appName}-pg'
  location: postgresLocation
  sku: {name: 'Standard_B1ms', tier: 'Burstable'}
  properties: {
    version: '16'
    administratorLogin: 'cgadmin'
    administratorLoginPassword: databasePassword
    storage: {storageSizeGB: 32, autoGrow: 'Disabled'}
    backup: {backupRetentionDays: 7, geoRedundantBackup: 'Disabled'}
    highAvailability: {mode: 'Disabled'}
    network: {publicNetworkAccess: 'Enabled'}
    authConfig: {passwordAuth: 'Enabled', activeDirectoryAuth: 'Disabled'}
  }
}
resource database 'Microsoft.DBforPostgreSQL/flexibleServers/databases@2024-08-01' = {
  parent: postgres
  name: 'changeguard'
  properties: {charset: 'UTF8', collation: 'en_US.utf8'}
}

output appUrl string = 'https://${app.properties.defaultHostName}'
output databaseResourceId string = postgres.id
