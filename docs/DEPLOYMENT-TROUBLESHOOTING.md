# Deployment Troubleshooting Guide

## Common Issues and Prevention

### Issue 1: Module System Mismatch (ES Modules vs CommonJS)

**Problem**: Service fails to start with "Cannot find package '@yachtparty/shared'" error.

**Root Cause**: Service configured as ES modules (`"type": "module"`) but shared package uses CommonJS.

**Prevention**:
1. All packages MUST use CommonJS (not ES modules)
2. Pre-deployment check now validates module consistency automatically

**How to Fix**:
```bash
# Remove "type": "module" from package.json
# Change "module": "ES2022" to "module": "commonjs" in tsconfig.json
# Remove .js extensions from relative imports

# Run consistency check
./scripts/check-module-consistency.sh
```

**Indicators**:
- Cloud Run logs show: `Error [ERR_MODULE_NOT_FOUND]: Cannot find package '@yachtparty/shared'`
- Container exits with code 1 immediately after starting
- Deployment succeeds but service never becomes ready

---

### Issue 2: Missing node_modules in Deployment

**Problem**: Dependencies not found at runtime even though they exist locally.

**Root Cause**: `.gcloudignore` excluding `node_modules` or rsync not copying dependencies properly.

**Prevention**:
1. Deployment script explicitly copies all dependencies
2. Post-deployment verification checks service health

**How to Fix**:
```bash
# Ensure deployment script copies node_modules correctly
# Check .dockerignore does NOT exclude node_modules
# Verify all @yachtparty packages are copied to deployment directory
```

**Indicators**:
- Service fails to start
- Logs show module resolution errors
- Missing dependency errors

---

## Deployment Best Practices

### 1. Always Run Pre-deployment Checks

The deployment script now automatically runs:
- Module system consistency check
- Package build verification

To run manually:
```bash
./scripts/check-module-consistency.sh
```

### 2. Verify Deployments

After deployment completes:
```bash
./scripts/verify-deployment.sh <service-name>
```

This checks:
- Service becomes ready within 2 minutes
- Health endpoint responds with HTTP 200
- No errors in recent logs

### 3. Monitor Deployment Logs

If deployment fails, check logs immediately:
```bash
# Get recent logs
gcloud run services logs read <service-name> --region=us-central1 --limit=50

# Follow logs in real-time
gcloud run services logs tail <service-name> --region=us-central1
```

### 4. Test Locally with Docker

Before deploying, test the deployment package locally:
```bash
cd .deploy-temp-<service-name>
docker build -t <service-name>-test .
docker run -p 8080:8080 --env-file ../.env <service-name>-test

# In another terminal
curl http://localhost:8080/health
```

---

## Quick Reference: Module System Requirements

### ✅ Correct Configuration

**package.json** (NO "type" field):
```json
{
  "name": "@yachtparty/service-name",
  "main": "dist/index.js"
}
```

**tsconfig.json**:
```json
{
  "compilerOptions": {
    "module": "commonjs",
    "target": "ES2022"
  }
}
```

**imports** (NO .js extensions):
```typescript
import { foo } from './utils/foo';  // ✅ Correct
import { bar } from './types';      // ✅ Correct
```

### ❌ Incorrect Configuration

**package.json** (DON'T add "type"):
```json
{
  "name": "@yachtparty/service-name",
  "type": "module",  // ❌ WRONG - Remove this!
  "main": "dist/index.js"
}
```

**tsconfig.json**:
```json
{
  "compilerOptions": {
    "module": "ES2022",  // ❌ WRONG - Use "commonjs"
    "target": "ES2022"
  }
}
```

**imports** (NO .js extensions for CommonJS):
```typescript
import { foo } from './utils/foo.js';  // ❌ WRONG - Remove .js
import { bar } from './types.js';      // ❌ WRONG - Remove .js
```

---

## Emergency Rollback

If a deployment goes wrong:

```bash
# Get previous revision name
gcloud run revisions list --service=<service-name> --region=us-central1

# Rollback to specific revision
gcloud run services update-traffic <service-name> \
  --to-revisions=<previous-revision-name>=100 \
  --region=us-central1
```

---

## Getting Help

1. **Check logs first**: `gcloud run services logs read <service-name> --limit=50`
2. **Verify module consistency**: `./scripts/check-module-consistency.sh`
3. **Test health endpoint**: `curl https://<service-url>/health`
4. **Check revision status**: `gcloud run revisions describe <revision-name> --region=us-central1`

If issues persist after following this guide, preserve the deployment directory (`.deploy-temp-<service-name>`) for debugging.
