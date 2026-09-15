targetScope = 'resourceGroup'
param location string = resourceGroup().location
@minLength(3)
@maxLength(35)
param appName string
param tenantId string = 'a72c5ca4-2803-4603-b2ed-1d4e1a6db4f2'
param authClientId string
@secure()
param authClientSecret string
@secure()
param databasePassword string

var postgresName = '${appName}-pg'
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
resource network 'Microsoft.Network/virtualNetworks@2024-05-01' = {
  name: '${appName}-vnet'
  location: location
  properties: {
    addressSpace: { addressPrefixes: ['10.42.0.0/16'] }
    subnets: [
      {
        name: 'web'
        properties: {
          addressPrefix: '10.42.1.0/24'
          delegations: [{name: 'web', properties: {serviceName: 'Microsoft.Web/serverFarms'}}]
        }
      }
      {
        name: 'database'
        properties: {
          addressPrefix: '10.42.2.0/24'
          delegations: [{name: 'postgres', properties: {serviceName: 'Microsoft.DBforPostgreSQL/flexibleServers'}}]
        }
      }
    ]
  }
}
resource dns 'Microsoft.Network/privateDnsZones@2024-06-01' = {
  name: '${appName}.postgres.database.azure.com'
  location: 'global'
}
resource link 'Microsoft.Network/privateDnsZones/virtualNetworkLinks@2024-06-01' = {
  parent: dns
  name: 'database-link'
  location: 'global'
  properties: {registrationEnabled: false, virtualNetwork: {id: network.id}}
}
resource postgres 'Microsoft.DBforPostgreSQL/flexibleServers@2024-08-01' = {
  name: postgresName
  location: location
  sku: {name: 'Standard_B1ms', tier: 'Burstable'}
  properties: {
    version: '16'
    administratorLogin: 'cgadmin'
    administratorLoginPassword: databasePassword
    storage: {storageSizeGB: 32, autoGrow: 'Enabled'}
    backup: {backupRetentionDays: 14, geoRedundantBackup: 'Disabled'}
    highAvailability: {mode: 'Disabled'}
    network: {
      delegatedSubnetResourceId: '${network.id}/subnets/database'
      privateDnsZoneArmResourceId: dns.id
      publicNetworkAccess: 'Disabled'
    }
    authConfig: {passwordAuth: 'Enabled', activeDirectoryAuth: 'Disabled'}
  }
  dependsOn: [link]
}
resource database 'Microsoft.DBforPostgreSQL/flexibleServers/databases@2024-08-01' = {
  parent: postgres
  name: 'changeguard'
  properties: {charset: 'UTF8', collation: 'en_US.utf8'}
}
resource plan 'Microsoft.Web/serverfarms@2024-11-01' = {
  name: '${appName}-plan'
  location: location
  kind: 'linux'
  sku: {name: 'B1', tier: 'Basic', capacity: 1}
  properties: {reserved: true}
}
resource app 'Microsoft.Web/sites@2024-11-01' = {
  name: appName
  location: location
  kind: 'app,linux'
  properties: {
    serverFarmId: plan.id
    httpsOnly: true
    virtualNetworkSubnetId: '${network.id}/subnets/web'
    siteConfig: {
      linuxFxVersion: 'NODE|24-lts'
      appCommandLine: 'node launch.mjs'
      alwaysOn: true
      ftpsState: 'Disabled'
      minTlsVersion: '1.2'
      scmMinTlsVersion: '1.2'
      healthCheckPath: '/api/health'
      appSettings: [
        {name: 'NODE_ENV', value: 'production'}
        {name: 'SCM_DO_BUILD_DURING_DEPLOYMENT', value: 'false'}
        {name: 'WEBSITE_RUN_FROM_PACKAGE', value: '1'}
        {name: 'CHANGEGUARD_AUTH', value: 'azure-easyauth'}
        {name: 'AZURE_TENANT_ID', value: tenantId}
        {name: 'APP_ORIGIN', value: 'https://${appName}.azurewebsites.net'}
        {name: 'MICROSOFT_PROVIDER_AUTHENTICATION_SECRET', value: authClientSecret}
        {name: 'PGHOST', value: postgres.properties.fullyQualifiedDomainName}
        {name: 'PGDATABASE', value: database.name}
        {name: 'PGUSER', value: 'cgadmin'}
        {name: 'PGPASSWORD', value: databasePassword}
        {name: 'PGSSLMODE', value: 'verify-full'}
      ]
    }
  }
}
resource authentication 'Microsoft.Web/sites/config@2024-11-01' = {
  parent: app
  name: 'authsettingsV2'
  properties: auth
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
output appResourceId string = app.id
output appUrl string = 'https://${app.properties.defaultHostName}'
