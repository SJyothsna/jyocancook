# JyoCanCook — Future implementation: automated staging and approved production deployment

Status: **planned, not implemented.** Today the packages are built and uploaded by hand (see `HOSTINGER_STAGING.md` and `HOSTINGER_PRODUCTION.md`).

The workflow will be:

1. Change code in `feature/hostinger-static-publishing`.
2. Push to GitHub — automatically run tests and deploy to staging.
3. Verify staging — check the changes.
4. Approve production deployment — GitHub Actions deploys the tested version to Hostinger.
5. Rebuild public pages when a layout change requires it, using your existing MySQL recipe data.
