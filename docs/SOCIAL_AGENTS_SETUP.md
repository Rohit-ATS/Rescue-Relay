# Social Media & AI Agent Integration Setup Guide

RescueRelay connects food banks and food distribution centers directly to Claude-powered AI Agents and real-time MCP servers for **LinkedIn, Instagram, X (Twitter), and Google Maps (Business Profile)**.

---

## 1. Fast Start: Dry-Run Mode (Zero Setup Required)

RescueRelay ships with full **simulated dry-run mode** enabled by default. You can test:
- AI broadcast drafting across all four platforms.
- Food safety checks (allergens, cold chain storage limits).
- Platform constraints (X 280-char counts, Instagram image requirements, GBP formatting).
- Approval workflows and publication history.

Posts generated in dry-run mode are tagged with `Simulated (Dry-Run)` in the activity log and do not require external API keys.

---

## 2. Live Platform App Registration

When your organization is ready to publish live to social feeds and Google Maps, register developer applications on each platform:

### 💼 A. LinkedIn Company Page
1. Go to the [LinkedIn Developer Portal](https://www.linkedin.com/developers/apps).
2. Create an App and link it to your verified LinkedIn Organization Page.
3. Under **Products**, add:
   - **Share on LinkedIn**
   - **Community Management API** (for organization updates and comments)
4. Under **Auth**:
   - Add Redirect URL: `https://<YOUR-SUPABASE-PROJECT>.supabase.co/functions/v1/oauth-callback`
   - Copy `Client ID` and `Client Secret`.
5. Set scopes: `openid profile w_member_social w_organization_social r_organization_social rw_organization_admin`.

---

### 📸 B. Instagram & Facebook Pages (Meta Graph API)
*Instagram requires a professional or creator account connected to a Facebook Page.*
1. Go to the [Meta for Developers Console](https://developers.facebook.com/).
2. Create an App of type **Business**.
3. Add **Instagram Graph API** and **Facebook Login for Business**.
4. Set Valid OAuth Redirect URIs:
   - `https://<YOUR-SUPABASE-PROJECT>.supabase.co/functions/v1/oauth-callback`
5. Permissions required:
   - `instagram_basic`
   - `instagram_content_publish`
   - `instagram_manage_comments`
   - `pages_show_list`
   - `pages_read_engagement`
6. Copy `App ID` and `App Secret`.

---

### 🐦 C. X (Twitter) API v2
1. Visit the [X Developer Portal](https://developer.x.com/en/portal/dashboard).
2. Create a Project and App with **User authentication settings** enabled.
3. App Permissions: **Read and Write**.
4. Type of App: **Web App, Automated App or Bot (Confidential Client)**.
5. Set Callback URI:
   - `https://<YOUR-SUPABASE-PROJECT>.supabase.co/functions/v1/oauth-callback`
6. Copy `Client ID` and `Client Secret` (OAuth 2.0 PKCE).

---

### 📍 D. Google Maps & Google Business Profile
*Enables automated Local Posts, Hours updates, and Review responses directly on your Google Maps pin.*
1. Go to the [Google Cloud Console](https://console.cloud.google.com/).
2. Create a project and enable:
   - **Google My Business API**
   - **My Business Business Information API**
   - **My Business Account Management API**
3. Create OAuth 2.0 Client ID (Web Application):
   - Authorized redirect URIs: `https://<YOUR-SUPABASE-PROJECT>.supabase.co/functions/v1/oauth-callback`
4. Copy `Client ID` and `Client Secret`.

---

## 3. Configuring Secrets in Supabase

Run the following commands using the Supabase CLI, or add them via the **Supabase Dashboard -> Edge Functions -> Secrets**:

```bash
# Claude AI key (enables Claude 3.5 Sonnet generation)
supabase secrets set ANTHROPIC_API_KEY="sk-ant-..."

# Token encryption key (32 bytes base64 encoded for AES-GCM at rest)
# Generate with: openssl rand -base64 32
supabase secrets set TOKEN_ENCRYPTION_KEY="your-32-byte-base64-key"

# LinkedIn
supabase secrets set LINKEDIN_CLIENT_ID="your_linkedin_client_id"
supabase secrets set LINKEDIN_CLIENT_SECRET="your_linkedin_client_secret"

# Meta / Instagram
supabase secrets set META_APP_ID="your_meta_app_id"
supabase secrets set META_APP_SECRET="your_meta_app_secret"

# X (Twitter)
supabase secrets set X_CLIENT_ID="your_x_client_id"
supabase secrets set X_CLIENT_SECRET="your_x_client_secret"

# Google Business Profile / Maps
supabase secrets set GOOGLE_CLIENT_ID="your_google_client_id"
supabase secrets set GOOGLE_CLIENT_SECRET="your_google_client_secret"

# Dashboard URL (for OAuth return redirects)
supabase secrets set APP_URL="https://rohit-ats.github.io/Rescue-Relay"
```

---

## 4. MCP Servers Endpoint Reference

Every platform MCP server runs as a standard Streamable HTTP JSON-RPC endpoint:

| Platform | MCP Server Endpoint | Provided Tools |
|---|---|---|
| **LinkedIn** | `/functions/v1/mcp-linkedin` | `create_post`, `get_post_stats`, `list_comments`, `reply_to_comment` |
| **Instagram** | `/functions/v1/mcp-instagram` | `publish_image_post`, `publish_story`, `list_comments`, `reply_to_comment`, `get_insights` |
| **X** | `/functions/v1/mcp-x` | `create_post`, `create_thread`, `list_mentions`, `reply` |
| **Google Maps** | `/functions/v1/mcp-google-business` | `create_local_post`, `list_reviews`, `reply_to_review`, `update_hours` |

You can also connect to these endpoints from external MCP clients (such as Claude Desktop or custom agents) using your Supabase anon/service key.
