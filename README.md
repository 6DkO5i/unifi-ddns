# 🌩️ Cloudflare DDNS for UniFi OS

A Cloudflare Worker script that enables UniFi devices (e.g., UDM-Pro, USG) to dynamically update DNS A/AAAA records on Cloudflare.

## Why Use This?

UniFi devices do not natively support Cloudflare as a DDNS provider. This script bridges that gap, allowing your UniFi device to keep your DNS records updated with your public IP address.

## 🚀 **Setup Overview**

### 1. **Deploy the Cloudflare Worker**

#### **Option 1: Click to Deploy**
[![Deploy to Cloudflare Workers](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/6DkO5i/unifi-ddns)

1. Click the button above.
2. Complete the deployment.
3. Note the `*.workers.dev` route.

#### **Option 2: Deploy with Wrangler CLI**
1. Clone this repository.
2. Install [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/install-and-update/).
3. Run:
   ```sh
   npm i
   wrangler login
   wrangler deploy
   ```
4. Note the `*.workers.dev` route.

### 2. **Generate a Cloudflare API Token**

1. Go to the [Cloudflare Dashboard](https://dash.cloudflare.com/).
2. Navigate to **Profile > API Tokens**
3. Create a token using the **Edit zone DNS** template.
4. Scope the token to **one** specific zone.
5. Save the token securely.

### 3. **Configure UniFi OS**

1. Log in to your [UniFi OS Controller](https://unifi.ui.com/).
2. Go to **Settings > Internet > WAN > Dynamic DNS**.
3. Create New Dynamic DNS with the following information:
   - **Service:** `custom`
   - **Hostname:** `subdomain.example.com` or `example.com`
   - **Username:** Cloudflare Account Email Address (e.g., `you@example.com`)
   - **Password:** Cloudflare User API Token *(not an Account API Token)*
   - **Server:** `<worker-name>.<worker-subdomain>.workers.dev/update?domain=SK&ip=%i&hostname=%h`
     *(Omit `https://`)*

## 🛠️ **Testing & Troubleshooting**

## Local Testing

### Environment Setup
For domain 'SK', you need to configure two environment variables:

1. For local development:
   - Create a `.dev.vars` file in your project root
   - Add the following variables:
     ```
     SK_CLIENT_API_KEY=your_client_api_key (ex: A1234567890Z) - to authenticate the client
     SK_CLOUDFLARE_API_TOKEN=your_cloudflare_token - token required for updates
     ```

2. For Cloudflare deployment:
   - Configure `SK_CLIENT_API_KEY` and `SK_CLOUDFLARE_API_TOKEN` as worker secrets
   - Access these in the Cloudflare Workers settings page

### Testing Commands

#### 1. Start Local Server and Setup Variables
```bash
# Start the local development server
npx wrangler dev

# In a new terminal, setup test variables
SK_CLIENT_API_KEY=A1234567890Z
WAN_IP=$(curl https://checkip.amazonaws.com)
HOST_NAME=test.example.xyz
AUTH_TOKEN=$(echo -n "$SK_CLIENT_API_KEY:" | base64)
```

#### 2. Test Local Endpoint
```bash
# Update DNS record for a hostname
curl "http://localhost:8787/update?domain=SK&ip=$WAN_IP&hostname=$HOST_NAME" \
  -H "Authorization: Basic $AUTH_TOKEN"
```

#### 3. Test Cloudflare Worker
```bash
# Update DNS record and default gateway location
curl "https://<worker-name>.<worker-subdomain>.workers.dev/update?domain=SK&ip=$WAN_IP&hostname=$HOST_NAME&gateway=Default" \
  -H "Authorization: Basic $AUTH_TOKEN"
```

Note: Replace `<worker-name>` and `<worker-subdomain>` with your actual Cloudflare Worker details.

Refer to the [original repo](https://github.com/willswire/unifi-ddns) for more details.
