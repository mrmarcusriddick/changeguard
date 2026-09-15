targetScope = 'resourceGroup'

@description('Use the same region as any existing Azure SQL free-offer databases in this subscription.')
param location string = resourceGroup().location
@minLength(3)
@maxLength(35)
param appName string
param tenantId string = 'a72c5ca4-2803-4603-b2ed-1d4e1a6db4f2'
@description('Object ID of the Entra user who will initialize the SQL database.')
param sqlAdministratorObjectId string
param sqlAdministratorLogin string

// Intentionally fixed: no paid SKU or bill-overage parameter is exposed.
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
    // Infrastructure only. Keep stopped until the Azure SQL adapter and Entra
    // sign-in registration have been implemented and verified.
    enabled: false
    siteConfig: {
      linuxFxVersion: 'NODE|24-lts'
      alwaysOn: false
      ftpsState: 'Disabled'
      minTlsVersion: '1.2'
      scmMinTlsVersion: '1.2'
      appSettings: [
        {name: 'NODE_ENV', value: 'production'}
        {name: 'CHANGEGUARD_COST_MODE', value: 'free-only'}
        {name: 'CHANGEGUARD_DATABASE_PROVIDER', value: 'azure-sql'}
        {name: 'AZURE_TENANT_ID', value: tenantId}
        {name: 'SQL_SERVER', value: sql.properties.fullyQualifiedDomainName}
        {name: 'SQL_DATABASE', value: database.name}
        {name: 'SCM_DO_BUILD_DURING_DEPLOYMENT', value: 'false'}
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
resource auth 'Microsoft.Web/sites/config@2024-11-01' = {
  parent: app
  name: 'authsettingsV2'
  properties: {
    platform: {enabled: true}
    globalValidation: {requireAuthentication: true, unauthenticatedClientAction: 'Return401'}
    httpSettings: {requireHttps: true}
  }
}
resource sql 'Microsoft.Sql/servers@2023-08-01' = {
  name: '${appName}-sql'
  location: location
  properties: {
    version: '12.0'
    minimalTlsVersion: '1.2'
    // No broad "Allow Azure services" firewall exception. Network access is
    // opened only for the app's outbound IPs when the adapter is connected.
    publicNetworkAccess: 'Disabled'
    administrators: {
      administratorType: 'ActiveDirectory'
      principalType: 'User'
      login: sqlAdministratorLogin
      sid: sqlAdministratorObjectId
      tenantId: tenantId
      azureADOnlyAuthentication: true
    }
  }
}
resource database 'Microsoft.Sql/servers/databases@2023-08-01' = {
  parent: sql
  name: 'changeguard'
  location: location
  sku: {name: 'GP_S_Gen5', tier: 'GeneralPurpose', family: 'Gen5', capacity: 2}
  properties: {
    useFreeLimit: true
    freeLimitExhaustionBehavior: 'AutoPause'
    maxSizeBytes: 34359738368
    minCapacity: json('0.5')
    autoPauseDelay: 60
    requestedBackupStorageRedundancy: 'Local'
    zoneRedundant: false
  }
}
output appResourceId string = app.id
output appIdentityObjectId string = app.identity.principalId
output databaseResourceId string = database.id
output runtimeStatus string = 'Blocked: Azure SQL adapter and sign-in setup required before starting app'
