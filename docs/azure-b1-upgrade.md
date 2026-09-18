# Authorized Basic B1 hosting

The owner upgraded the existing App Service plan to Basic B1. Infrastructure and delivery now require B1 and retain one instance. Higher SKUs and a downgrade to F1 are not authorized.

Existing resource names (including the `-free` suffix) and the `changeguard-free` resource group are retained to update the existing resources. PostgreSQL remains Standard_B1ms with 32 GB storage and its existing cost controls. Its region remains Central US.

The template now declares B1/Basic so a future provisioning run cannot silently revert the plan to F1. Delivery verifies the live plan before starting the app. This hosting change does not assert that the unresolved PostgreSQL/startup issue is fixed; the worker probe and authenticated release checks must still pass.
