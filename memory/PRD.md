# Smart Workplace Assistance & Internal Service Communication Platform — PRD

## Original Problem Statement
Build a modern enterprise-grade Smart Workplace Assistance & Internal Service Communication Platform that works across mobile, tablet, and web browsers. The platform streamlines internal office communication and operational assistance between meeting rooms, cabins, conference rooms, training halls, executive spaces, reception, cafeteria, admin, facilities, IT support, and security teams. Goal: eliminate manual communication methods (calls, walk-ins, messaging) for small operational requests with a real-time intelligent request management system.

## User Choices
- Database: **MongoDB**
- Auth: **JWT email/password (httpOnly cookie + Bearer fallback)**
- Real-time: **Socket.IO WebSockets** (mounted at /api/socket.io)
- MVP scope: Room QR/PIN + one-touch requests + role dashboards + admin panel + analytics + sound/in-app toasts
- Design: Swiss & High-Contrast (selected by design agent) — Outfit / IBM Plex Sans / JetBrains Mono fonts

## User Personas
- **Room User** (tablet, kiosk mode): scans QR / enters PIN to access room interface, taps one-touch buttons to request services.
- **Reception / Cafeteria / IT Support / Facilities / Security**: dashboard users responding to requests scoped to their department.
- **Admin / Super Admin**: full configuration access — rooms, categories, routing, users, analytics.

## Core Requirements (static)
- Unique Room ID + QR + PIN per room, configurable name, floor, location, dept
- One-touch request buttons grouped by category (Hospitality, Office Supplies, Facilities, IT, Security, Emergency)
- Smart routing engine (category → department) with admin-configurable rules + per-rule escalation timing
- Status lifecycle: Requested → Accepted → In Progress → Delivered → Closed → Escalated (with timestamps + history)
- Role-based dashboards with real-time updates, response timers, escalation flags, sound notifications
- Admin panel for rooms/categories/routing/users/departments
- Analytics: most-requested, top rooms, hourly/daily volume, response/delivery times, CSV export
- Multi-screen responsive (mobile / tablet kiosk / desktop dashboard)

## Iteration 6 (2026-02-19) — Multi-Location User Management

- **Backend**:
  - `routers/users.py` GET /users now supports server-side filters: `location_id`, `department_id`, `role`, `q` (regex-escaped name/email search), `sort` (name/email/role/created_at), `order` (asc/desc) with `_SORTABLE` whitelist.
  - POST/PATCH /users accept `extra_location_ids: list[str]` (read-only cross-location visibility). `_validate_extras` dedupes + removes primary; `_enforce_admin_scope` prevents privilege escalation. `super_admin` role auto-clears `location_id` + `extra_location_ids`.
  - `core/scope.py` allows read access through `extra_location_ids` for non-super-admins; writes still bound to primary `location_id`.
  - `models.py` User: `extra_location_ids: list[str] = []`.

- **Frontend (`/app/frontend/src/pages/AdminUsers.jsx`)**:
  - New filter bar: Search (debounced 250ms), Location dropdown, Department dropdown, Role dropdown, Clear filters, result count.
  - Sortable column headers (name/email/role/created_at) with asc/desc toggle.
  - Create/Edit dialog: Primary location (disabled for non-super-admin), Extra locations checkbox list (excludes selected primary).
  - User row shows primary location chip + extra-location chips (e.g., "HQ — Bengalore" + "+ HQ-Vizag").
  - All interactive elements carry `data-testid` (users-filter-bar, users-search-input, users-filter-location/department/role, users-sort-*, users-create-btn, user-extras-list, user-extra-{id}, user-submit-btn, etc.).

- **Tests**: 9 new pytest cases in `/app/backend/tests/test_users_filters.py` covering filters, extras CRUD, super-admin auto-clear, non-admin scoping. **Backend now 77/77 PASS.**
- **E2E verified by testing agent**: filter bar, search debounce, sort toggle, create-with-extras, edit pre-populate, delete, AdminRooms location switch regression all green.

## Iteration 20 (2026-02-19) — Tiny URL for rooms + TekWissen brand on every kiosk page

User asks: shorten the room URL (was `…/room/482963`, 14-char path) and surface the brand mark (TekWissen logo + EZ pill) on every kiosk + login page just like the admin sidebar shows it.

### Tiny URL
- Each room now has a 4-char alphanumeric `short_code` (alphabet excludes 0/o/1/l for legibility) → URL becomes `…/r/havg` (8-char path).
- Backend:
  - `routers/rooms.py`: generates a unique `short_code` on create + regenerate-pin; exposes `GET /api/rooms/by-short/{code}` (public) returning the room's PIN + location.
  - `rebuild-qr` endpoint backfills `short_code` for any room missing one and rebuilds the QR image.
  - `seed.py` startup hook backfills `short_code` for ALL existing rooms (18/18 rooms verified).
- Frontend:
  - New `/r/:code` route → `pages/RoomShortRedirect.jsx` resolves the code → navigates to `/room/<pin>` (with branded splash during the brief lookup).
  - QR codes now embed the short URL (rebuild-qr endpoint regenerated all 18 room QR images).
  - AdminRooms cards display the short URL form (e.g. `…/r/havg`) instead of the old long one — clickable + copy-friendly.

### TekWissen brand on every page
- Added `<BrandLogo>` to RoomKiosk, RoomOrder, RoomControls headers (same TekWissen logo + EZ pill seen on the admin sidebar).
- StaffLogin + VisitorCheckin already had it (iterations 11+12).
- Branding is now consistent across the admin sidebar, staff login, room kiosk, room order, room controls, and the new `/r/:code` redirect splash.

## Iteration 19 (2026-02-19) — Menu items in Routing section

User wanted the `/admin/routing` page to also list menu items (food/drink) so each item's notification target can be customised — not just categories.

Backend:
- `MenuItemCreate/Update` models: new optional `department_ids: List[str]`.
- `POST /preorders` in `cafeteria.py`: resolves the order's target departments by looking up every line item's `department_ids` (each item can override its routing); falls back to the location's Cafeteria for items without an override. The preorder is created with the UNION of all involved departments.
- `PATCH /menu/{id}` already accepts arbitrary fields → `department_ids` is now persisted.

Frontend (`/app/frontend/src/pages/AdminRouting.jsx`):
- Two grouped tables: **Service request categories** (top, existing) and **Menu items (food orders)** (new).
- Each menu item shows a multi-select popover (same UI as categories) — defaults to the location's Cafeteria when no override is set.
- Save → `PATCH /menu/{id} { department_ids: [...] }`.
- New chip removal, location-scoped department list (no cross-location routing).

All 45 menu items + all 125 categories now appear in `/admin/routing` as editable rows. Newly-added menu items appear automatically (the page refetches on mount + location switch).

## Iteration 18 (2026-02-19) — Backfill routing rules for ALL existing categories

User: existing categories (created before iteration 15's auto-create) weren't appearing as explicitly-editable rows on `/admin/routing` — only new ones were. Verified backend: **125 categories** existed but only 45 had explicit routing rules; 80 fell back to the category's own department which made the routing UI confusing.

Fix: added a one-shot backfill block in `seed.py` (runs on every backend startup; idempotent — only inserts rules for categories that don't already have one). After restart:
- Categories: 125
- Routing rules: 170 (some have multi-dept)
- **Categories without a rule: 0**

Every existing category now appears on `/admin/routing` as an explicit, editable row. Newly-added categories continue to auto-create their rule via `POST /api/categories` (iteration 15).

## Iteration 17 (2026-02-19) — 5s polling + 30s persistent toasts (true real-time feel)

User feedback after Iteration 16: super_admin still gets toasts immediately but non-admin tabs (cafeteria etc.) only show the new request when they switch to that tab — no toast/sound on arrival. **Root cause analysis**: with multiple tabs in the same browser window, only ONE tab is "foreground" at a time. The other tabs are technically "hidden" from Chrome's perspective, so:
- Audio is suspended (no `playEventSound`)
- Sonner toasts fire but the user can't see them (tab is hidden)
- By the time the user switches tabs, the 4-second default toast has already expired

**Fixes**:
1. **Polling reduced to 5 seconds** (was 20s) — every tab refetches every 5s regardless of focus, guaranteeing ≤5s "live" feel.
2. **Toast duration extended to 30 seconds** on `request:new` + `preorder:new` (both socket path and polling-diff path). User has ample time to switch to the tab and still see the alert visually.
3. **OS notifications** continue to fire from `notifyBackground` whenever the tab is hidden OR the browser window is unfocused — surface-level alerts even when no tab is foreground.

## Iteration 16 (2026-02-19) — Multi-tab session isolation + food-order full lifecycle + faster polling

User feedback after Iteration 15:
1. Non-admin tabs still don't get real-time notifications — only after switching tabs and coming back. → 2 root causes:
   - localStorage mirror in `token.js` was overwriting other tabs' tokens. When a fresh tab opened, /auth/me succeeded with the LAST logged-in user — so logging in as Cafeteria in tab 2 silently changed Tab 1 to also see Cafeteria's data on its next API call. Fix: REMOVED localStorage mirror; tokens are now **pure sessionStorage** (per-tab, survives refresh, dies on tab close).
   - Socket events do reach non-admin tabs but if the socket silently dies during long idle, we don't notice until visibility change. Fix: drop polling from 60s → **20s**, plus explicit `socket.on("disconnect")` listener that immediately re-connects.

2. Background tab OS notifications "still not working" → `notifyBackground` only fired when `visibilityState === "hidden"`. Now it also fires when the browser window itself isn't focused (`document.hasFocus() === false`). The tab-title badge follows the same broader rule. Also added a **`<NotificationsBanner />`** at the top of the Live Queue prompting users to actually click "Enable" — the API only fires alerts if permission is `granted`.

3. Food orders disappeared after Accept → **CRITICAL BUG FIXED** in `StaffDashboard.jsx` filter:
   - `"active"` filter for preorders was `["pending", "preparing", "out_for_delivery"]` — missing `"accepted"`. After Accept, status became "accepted" but wasn't in the active list → row vanished.
   - Fixed to `["pending", "accepted", "preparing", "out_for_delivery"]`. Cafeteria now sees the full lifecycle Accept → Start → Ready and the kiosk receives `preorder:update` events at each step. (Stats counter `pending` also fixed to include `"accepted"`.)

4. Newly-added categories appearing in Routing — confirmed working: `POST /api/categories` now auto-creates a default routing rule (Iteration 15). All existing AND newly created categories appear on `/admin/routing` — admins can adjust the department list at any time.

Files: `lib/token.js`, `lib/notify.js`, `lib/auth.jsx`, `lib/api.js`, `pages/StaffDashboard.jsx`, `components/NotificationsBanner.jsx`.

## Iteration 15 (2026-02-19) — Background notifications, multi-tab login, polling reliability

User reported:
- 3 different users (cafeteria, reception, IT) in 3 tabs of the same browser — only one stays logged in at a time, and missed notifications when tab is in background.
- Background tabs miss notifications + sound.
- Cafeteria sometimes misses a food-order notification entirely.
- Newly-added categories don't appear in routing without manual config.

Fixes:

### 1. Per-tab authentication (true multi-user)
- Moved token storage to `sessionStorage` (per-tab) via new `/app/frontend/src/lib/token.js`. `localStorage` is kept as a mirror so single-tab users still get auto-login after refresh.
- Now 3 tabs can hold 3 different users simultaneously without overwriting each other's session.

### 2. Background tab notifications (OS-level)
- New `/app/frontend/src/lib/notify.js`:
  - `ensureNotificationPermission()` prompts the user once for browser Notification permission.
  - `notifyBackground({ title, body, tag })` fires an OS-level Notification when the tab is hidden — survives background throttling.
  - Document title flashes with `(N) original title` count while hidden.
  - Auto-clears badge when tab regains focus.
- StaffDashboard wires `notifyBackground` into both socket handlers (request:new, preorder:new) AND into the polling fallback (load() detects items that arrived while idle).

### 3. Robust polling fallback (60s + tab focus)
- Polling interval reduced from 120s → 60s.
- On `visibilitychange → visible`: forces socket reconnect (some browsers silently close idle sockets) and triggers an immediate refetch.
- `load()` diffs the new payload against last-known IDs and fires toast + sound + OS notification for any items that arrived while the socket missed them.
- Socket handlers and polling share the same `knownIdsRef` set, so an item received by BOTH never double-buzzes.

### 4. Newly-added categories appear in Routing automatically
- `POST /api/categories` now also creates a default routing rule (`department_ids: [category.department_id]` if provided, `[]` otherwise). New categories show up on `/admin/routing` immediately, ready to customise.

### 5. Notification routing (re-confirmed from Iteration 14)
- Pre-orders carry `department_id` of the Cafeteria dept; backend `GET /preorders` filters non-admin staff by dept; frontend `isMyDepartment(entity)` accepts both `department_id` and `department_ids` fields.

I did NOT run E2E tests per the user's instruction. Backend lints clean, services healthy. Please re-run the 3-tab test (cafeteria + reception + it_support) — each tab will now stay logged in as a separate user, and the cafeteria tab will get OS-level notifications even when the browser is minimised.

## Iteration 14 (2026-02-19) — Notification routing: dept-strict filtering for requests + pre-orders

User reported: ordering a food item (e.g. Ice Cream) was notifying ALL logged-in users in the location — Reception, IT Support, Cafeteria, Admin — instead of only Cafeteria + Admins as expected. Even after configuring Routing rules, the issue persisted.

Root causes:
1. **Pre-orders had no `department_id`** — frontend filter was role-only (`role !== "cafeteria"`) which was fragile. Pre-orders now carry `department_id` + `department_ids` resolved from the Cafeteria department of the order's location.
2. **`GET /api/preorders`** returned all preorders to any authenticated user — no department filtering. Bypass for `/orders` page was wide open.
3. **Frontend `onNew`/`onPreNew`** had a subtle null-equality hole: `req.department_id === user.department_id` would be `true` when both were `null` (e.g. unrouted request + user with no dept). Now both sides MUST be truthy to match.

Backend fixes (`/app/backend/routers/cafeteria.py`):
- `create_preorder` resolves the Cafeteria dept_id by name regex (`/cafeter/i` — survives renames + translations) and persists `department_id` + `department_ids` on every new preorder.
- `list_preorders` filters non-admin staff with `$or: [{department_id: dept}, {department_ids: dept}]` — same pattern as requests.
- `seed.py` backfills `department_id` on historical pre-order rows so old orders don't suddenly disappear after deploy.

Frontend fixes (`/app/frontend/src/pages/StaffDashboard.jsx`, `AdminPreorders.jsx`):
- Single source of truth `isMyDepartment(entity)`:
  - `super_admin` → always true
  - `admin` → always true (admins see EVERY event in their location, as the user explicitly requested)
  - Else: `entity.department_id === user.department_id` (both truthy) OR `entity.department_ids.includes(user.department_id)` (multi-dept routing). Anything else: ignored.
- Applied to **all four** socket handlers (request:new/update, preorder:new/update) and on the `/orders` admin page too.

Behaviour now matches the user's spec exactly:
- Reception, IT Support, Facilities, Security → NO notifications for food orders / cafeteria requests.
- Cafeteria → notified for food orders + any category routed to Cafeteria.
- Admin → notified for everything in their location.
- Super_admin → notified for everything across locations.
- When a routing rule is changed, the very next request is delivered to the new department(s) — no stale subscriptions.

## Iteration 13 (2026-02-19) — Inline "Add new" for Role + Department in New-User dialog

User asked: when creating a new user, allow adding a brand-new role/department directly from the role/department dropdown.

- **Backend**:
  - New `routers/roles.py` — `GET /api/roles` returns built-ins (super_admin, admin, reception, cafeteria, it_support, facilities, security) + entries from the new `custom_roles` MongoDB collection. `POST /api/roles {label}` creates a custom role (auto-slugified to `value`).
  - `routers/users.py` now validates roles via `is_role_allowed()` which checks built-ins ∪ custom_roles (replaces the previous static `ALLOWED_ROLES` check in POST + PATCH).
- **Frontend**:
  - New `components/SelectWithAdd.jsx` — drop-in Select component with an inline "+ Add new" footer that opens a small text field. On Enter/confirm, calls a configurable `onAdd(label)` → returns the new option → auto-selects it.
  - `AdminUsers.jsx` uses it for both Role (POST /api/roles) and Department (POST /api/departments). The Role dropdown also displays a small "CUSTOM" badge next to user-created roles for clarity.
  - Stale hard-coded `ROLES` constant removed; the Role filter on the users page also reads from `/api/roles` so newly-added roles appear there too.
- **Tests**: `tests/test_custom_roles.py` adds 5 new pytest cases — list, create, slugify, reject built-in duplicates, reject custom duplicates, reject unknown roles on user create. **Full suite 95/95 PASS** (one pre-existing flaky escalation-worker timing test passes in isolation).

## Iteration 12 (2026-02-19) — Live-queue auto-refresh, room short URL, admin user-creation polish

User requests:
1. **"Live Queue doesn't notify after long idle"** — Socket connections drop when the tab is idle for 10–15 mins; events between drop/reconnect are lost. Fix:
   - **2-minute polling fallback** on `StaffDashboard.jsx` — `setInterval(load, 120000)` runs even when idle, so the queue self-heals without a manual refresh.
   - **Re-fetch on tab visibility change** + **on `window.focus`** — instant catch-up the moment the user comes back to the tab.
   - **Force socket re-join on tab visibility** in `LocationProvider` — reconnects + re-emits `join_location` so we never silently lose room membership after a long idle.
2. **"Admin creates new users"** — Already supported by the backend (`resolve_target_location` auto-fills the admin's own `location_id`; `_enforce_admin_scope` rejects cross-tenant writes). Polished the UI: when a non-super-admin opens "New User", a hint below the disabled location dropdown reads "New users you create here will be assigned to HQ — Bengalore automatically."
3. **"Room short URL beside the PIN"** — `AdminRooms.jsx` now shows the actual room URL (e.g. `officeflow-pro.preview.emergentagent.com/room/123456`) under the room name. Clickable and selectable for people who want to type it instead of scanning the QR.

**Tests**: 4 new pytest cases (`tests/test_admin_creates_user.py`) lock in: (a) admin's new user inherits admin's location, (b) admin cannot cross-tenant via `location_id` override, (c) super_admin can pick any location.
**Test suite**: 90/90 backend pytest PASS.
**Verified visually**: Rooms cards show short URLs; Live Queue refreshes; New User dialog opens cleanly.

## Iteration 11 (2026-02-19) — Visitor flow fixes (QR scan, copy link, Done button)

User-reported issues from screenshots:
1. **Visitor invite "Copy link" button always failed** — `navigator.clipboard.writeText` is blocked in some browser contexts (iframes, non-focused docs). Added a `<textarea>` + `document.execCommand("copy")` fallback so the button works everywhere.
2. **QR codes (admin invite + visitor badge) couldn't be scanned by phone cameras** — root cause: backend was encoding only the relative path (`/visitors/checkin?pin=…`) into the QR. Fixed in `/app/backend/routers/visitors.py:_checkin_url()` — QR now embeds the absolute `FRONTEND_URL` + path. Verified via OpenCV QR decoder: both `checkin_qr` (admin invite) and `badge_qr` (visitor badge) now decode to `https://…/visitors/checkin?pin=XXX`.
3. **"Done" on visitor self-checkin redirected to admin login** — `navigate("/")` triggered the auth guard. Fixed by replacing with `resetAll()` which resets state and returns to the PIN entry screen (proper kiosk behaviour, ready for next visitor).
4. **Admin invite QR was too small** (128px) — bumped to 224px with full-width layout.
5. **Visitor badge QR was too small** (80px) — bumped to 112px.

Also: in the process of debugging, discovered the demo CEO Cabin PIN had been rotated away from `123456` (probably during admin UI exploration) which had broken `tests/test_smart_workplace.py`. Restored.

- **Regression coverage**: `tests/test_visitor_qr.py` — 3 new pytest cases:
  1. Pre-register response has absolute `checkin_url`
  2. `checkin_qr` decoded via OpenCV QR detector → absolute https URL
  3. `badge_qr` from `/visitors/badge-public/{pin}` → absolute https URL
- **Test suite**: 87/87 backend pytest PASS.
- **E2E verified**: full visitor self-checkin flow → Done returns to PIN entry screen (NOT admin login).

## Iteration 10 (2026-02-19) — Cross-location bleed: defense-in-depth client filter

- **Issue recurrence**: User reported Vizag Boardroom Coffee order still appeared in HQ-Bengalore dashboard after Iteration 9 fix. Root cause: the Iteration 9 socket-room fix is correct, but hot-reload preserves React state and does NOT re-run the LocationProvider effect when component deps are referentially equal — so a long-running browser session was still subscribed to the OLD SUPER_ROOM membership server-side.
- **Defense-in-depth fix** (`/app/frontend/src/pages/StaffDashboard.jsx`): every socket handler (`request:new`, `request:update`, `preorder:new`, `preorder:update`) now also drops events where `event.location_id !== expectedLoc` (super_admin in "All locations" mode accepts everything; everyone else is pinned to their selected/assigned location). Even if a stale room subscription leaks an event, the UI cannot render it.
- **End-to-end verified**: Created a Vizag request while a Bengalore dashboard was open — the Bengalore dashboard stayed empty (count 0, "No requests in this view").
- **Test suite**: 84/84 backend pytest still PASS.

## Iteration 9 (2026-02-19) — Socket cross-location bleed fix

- **Bug reported**: Pre-order placed from Bengalore was notifying every location's dashboard.
- **Root cause**: Frontend `LocationProvider` always joined the super_admin to `SUPER_ROOM` regardless of which location was selected. Because `emit_scoped` broadcasts every event to BOTH the location room AND `SUPER_ROOM`, a super_admin viewing a SPECIFIC location was still receiving events from every other location via the `SUPER_ROOM` backdoor.
- **Fix** (`/app/frontend/src/lib/location.jsx`): only join `SUPER_ROOM` when `activeLocationId === null` (i.e., the explicit "All locations" mode). When a specific location is picked, the socket joins ONLY that location's room.
- **Regression coverage**: `tests/test_socket_isolation.py` — 2 new pytest cases:
  1. Socket joined to specific location does NOT receive other locations' `request:new` events.
  2. Socket joined with `super: true` (All-locations mode) DOES receive cross-location events.
- **Test suite**: 84/84 backend pytest PASS.
- **Note**: `websocket-client` added to `requirements.txt` for the new tests.

## Iteration 8 (2026-02-19) — PickLocationDialog (auto-prompt before creating in "All locations" mode)

- **Problem**: Super_admins on "All locations" view who clicked + New Room/Category/Department/Menu/User got a backend 400 because tenant-scoped resources require a location.
- **Fix**: New `PickLocationDialog` (rendered globally by `LocationProvider`) + `requireLocation(callback, label)` API on `useLocation()`.
  - Non-super-admin users (always have a location) → callback runs immediately.
  - Super_admin on "All locations" → modal opens asking which location to use; on Continue we set the active location, then the create dialog opens automatically.
- **Pages updated** (5): AdminRooms, AdminCategories, AdminDepartments, AdminMenu, AdminUsers. Removed `<DialogTrigger>` wrapping so the button's click can be intercepted by `requireLocation`.
- **Linted, full pytest suite still 82/82 PASS, end-to-end flow verified via screenshot** (Rooms + Users tested in "All locations" mode).

## Iteration 7 (2026-02-19) — Multi-Department Routing + "All locations" view

- **Multi-Department Routing**:
  - `routing_rules.department_ids: List[str]` — a single category can now be routed to multiple departments; ANY of them can claim the request.
  - `RoutingRuleCreate` accepts `department_ids` (preferred) OR legacy `department_id`; server normalises into a deduped list. First entry becomes `department_id` (primary, kept for backward-compat reads + analytics).
  - `requests.py create_request`: persists both `department_id` (primary) and `department_ids` (full list).
  - `GET /api/requests` and analytics: non-admin staff filter is now `$or: [{department_id: user.dept}, {department_ids: user.dept}]`. Explicit `?department_id=` filter matches either field too.
  - **Staff Dashboard**: `onNew` socket handler and isMine check accept either field, so live updates flow to every routed department instantly.
  - **AdminRouting.jsx**: replaced single `<Select>` with a `Popover` + checkbox multi-select. Department list per row is filtered to the category's own location so "All locations" admins never cross-route.
  - Seed backfills `department_ids: [department_id]` on legacy routing rules + requests.

- **"All locations" view for super_admin**:
  - `LocationSwitcher` adds an "All locations" option at the top of the dropdown (sentinel `__all__`). Selecting it sets `activeLocationId = null` → axios stops auto-injecting `?location_id=` → backend's `scope_filter` returns `{}` for super_admin → cross-location data returned.
  - Socket: super_admin always joins SUPER_ROOM (`super: true`), so events from every location are received in real-time.
  - Choice persists across page refresh via `localStorage["sw_active_location"] = "__all__"` sentinel honoured by both `location.jsx` (state) and `location_holder.js` (axios interceptor).
  - Non-super-admin users continue to see a read-only chip (no "All" option).

- **Tests**: `tests/test_multi_dept_routing.py` adds 5 new pytest cases. **Backend now 82/82 PASS.**

## What's been implemented — 2026-02-15
- **Backend (FastAPI + Motor + python-socketio):**
  - JWT auth (cookie + Bearer), bcrypt hashing, admin + 5 demo staff seeded
  - Models & endpoints: auth, rooms (CRUD + regenerate-pin + public access), categories (CRUD + active toggle), departments, routing-rules (upsert), requests (public POST + status transitions + history), users (admin CRUD), analytics overview, CSV export
  - QR code generation as data URLs (qrcode library)
  - Socket.IO server emits `request:new` and `request:update` events
  - 6 departments + 24 categories + 5 rooms seeded with default routing rules
  - Demo room PIN `123456` for CEO Cabin
- **Frontend (React + Tailwind + Shadcn + Phosphor):**
  - Landing page with room PIN entry + staff CTA
  - Staff login with split-screen office imagery
  - Room kiosk (tablet-optimized) with grouped tile grid, confirm dialog, recent requests poll
  - Staff dashboard with KPIs, filter tabs, full status pipeline visualization, accept/start/deliver/close/escalate actions, live Socket.IO updates, toast + audio notifications
  - Admin: Rooms (with QR viewer + regenerate), Categories (group + toggle), Users (CRUD), Routing (per-category dept + escalation), Analytics (4 Recharts charts + CSV export)
  - AuthContext, ProtectedRoute, role-based admin gating

## Test Status (2026-02-15)
- Iteration 2: 47/47 backend pytest tests pass
- All frontend flows verified by Playwright through testing agent
- Success rate: 100% backend / 100% frontend

## Iteration 5 (2026-02-15) — Multi-location (multi-tenant) architecture

- **Backend**:
  - New `core/scope.py` with `scope_filter()` and `resolve_target_location()` helpers — central rule: super_admin can pass `?location_id=` to override (or omit for cross-location admin view); all other roles are auto-scoped to their `user.location_id` and get 403 on cross-location reads/writes.
  - New `routers/locations.py` — full CRUD; DELETE refuses if any room/category/dept/user/menu/routing-rule still attached.
  - All tenant-scoped routers (`rooms`, `requests`, `cafeteria`, `visitors`, `iot`, `catalog`, `users`, `analytics`) updated to use `scope_filter`/`resolve_target_location`. Kiosk `POST /api/requests` inherits `location_id` from the resolved Room (client cannot spoof). Cross-location PATCH/DELETE rejected with 403.
  - Cross-location safeguard on `POST /api/requests`: returns 400 if category and room belong to different locations.
  - `models.py` — new `LocationCreate`/`LocationUpdate`. Tenant create models accept optional `location_id`. Fixed `MenuItemCreate`/`MenuItemUpdate` (missing field caused 500 in iteration-5 testing).
  - `seed.py` — creates default `HQ — Default` location, backfills `location_id` on all 10 pre-existing collections, ensures super_admin user has `location_id=None`. Idempotent.
  - 12 new pytest regression tests in `tests/test_multi_location.py`; existing tests updated to inject `location_id` for super_admin tenant creations and to use the current preorder transition graph (`pending → accepted → preparing → delivered`). **68/68 backend tests pass.**

- **Frontend**:
  - New `lib/location.jsx` — `LocationProvider` + `useLocation()` hook. Synchronously hydrates the active location from localStorage at component init (and at module load for the axios interceptor) so the very first scoped GET after a page refresh is already filtered. Skips re-initialisation while `AuthProvider` is still loading (user === null).
  - New `lib/location_holder.js` — module-level holder read by the axios interceptor without creating circular imports.
  - `lib/api.js` interceptor — auto-injects `?location_id=` on GET to scoped endpoints (rooms / requests / categories / departments / routing-rules / users / menu / preorders / visitors / iot/commands / analytics) and merges `location_id` into POST body for super_admin tenant creations (`/rooms`, `/categories`, `/departments`, `/menu`, `/users`).
  - New `components/LocationSwitcher.jsx` in AppShell header — Radix Select for super_admin, read-only chip for other roles.
  - New `pages/AdminLocations.jsx` — list/create/edit/delete + "Switch to" affordance per card. Route `/admin/locations` is super_admin-only.
  - Every admin page (Rooms, Categories, Departments, Menu, Users, Routing, Analytics, Visitors, Preorders) and StaffDashboard now subscribes to `useLocation()` and re-fetches when `activeLocationId` changes.
  - Kiosk pages (`RoomKiosk`, `RoomOrder`) now load categories / menu scoped to the room's `location_id` returned by `POST /rooms/access`.

- **Test status (2026-02-15)**: 68/68 backend pytest pass; E2E location switching verified via Playwright (Test_Branch_A → 0 rooms, HQ — Default → 8 rooms, instant refetch on dropdown change).


## Iteration 4 (2026-02-15) — core/ package + failed dispatches + test cleanup

- **core/ subpackage**: `core.py` (~150 lines) → `core/{db,auth,notify,utils}.py` with `__init__.py` re-exporting the iteration-3 import surface for backwards compatibility. Routers/seed unchanged.
- **Failed notification dispatches**: `dispatch_notification` now persists every per-channel failure to a new `failed_dispatches` collection (channel, event, error, payload_id, resolved, created_at). Captures both HTTP 4xx/5xx and connection exceptions.
- **Admin endpoints**:
  - `GET /api/settings/failed-dispatches?include_resolved=bool&limit=N`
  - `PATCH /api/settings/failed-dispatches/{id}/resolve` (404 on missing)
  - `DELETE /api/settings/failed-dispatches?only_resolved=bool`
- **Admin UI**: "Failed dispatches" card on `/admin/settings` — open count badge, Mark Resolved, Show/Hide resolved, Clear Resolved.
- **Test cleanup fixture**: `/app/backend/tests/conftest.py` autouse session-scoped fixture purges TEST_/ESC_TEST_/ESC_FRESH_/PYTEST_ rows across 11 collections before AND after every pytest run (including `note` field on requests).
- **Test status**: 56/56 backend pytest pass (51 regressions + 5 new failed-dispatch lifecycle cases). Frontend verified live.


- **Backend modularization**: server.py reduced from ~1230 → ~105 lines. Split into:
  - `core.py` — db client, sio, auth deps, JWT, helpers, `dispatch_notification`
  - `models.py` — all Pydantic models + STATUS_TRANSITIONS + PREORDER_TRANSITIONS
  - `seed.py` — `seed()` + `escalation_worker()`
  - `routers/{auth,rooms,catalog,requests,users,analytics,visitors,cafeteria,iot,settings}.py`
- **Server-side escalation auto-flip**: `escalation_worker()` runs on startup as a background asyncio task, scans every 30s for active requests (status in `requested|accepted|in_progress`) whose age exceeds `escalation_minutes`. Flips them to `escalated`, sets `escalated_at`, appends `{by: "system", note: "auto-escalated after Nm"}` to history, emits `request:update` socket event, fires `dispatch_notification("auto_escalated", req)`.
- **Settings masking**: GET `/api/settings` now masks Slack and Teams webhook URLs (in addition to WhatsApp token).
- **Pre-order PATCH**: now accepts JSON body `{status}` (was query param) + transition validator + 404 on missing id.
- **Test status**: 51/51 backend pytest pass (added 2 escalation worker tests + 2 preorder transition tests).


- **Backend hardening**: PIN re-check on `POST /api/requests`, status-transition validator (STATUS_TRANSITIONS dict), dept-scoped analytics for non-admins, CORS regex allowlist
- **Visitor management**: collection + CRUD + socket `visitor:new`/`visitor:update`, status pipeline `waiting → notified → checked_in → checked_out`
- **Pre-orders**: menu + cart-style endpoint with PIN validation, transition validator (`pending → preparing → out_for_delivery → delivered`), cafeteria queue view
- **IoT command bus**: `/api/iot/command` with PIN, persisted to `iot_commands`, broadcast as `iot:command` socket event (ready for MQTT/HA bridge)
- **Notification dispatch stubs**: Slack / Teams / WhatsApp webhooks configurable in `/admin/settings`; `dispatch_notification` is best-effort + swallows failures + masks secrets in GET response
- **Department CRUD UI** at `/admin/departments`
- **Menu management UI** at `/admin/menu`, kiosk pulls only available items
- **Kiosk modes**: tablet now has 3 modes — Request, Order Food (`/room/:pin/order`), Room Controls (`/room/:pin/controls`)
- **PWA**: `manifest.json` + service worker (caches shell, skips `/api/*`), registered in `index.js`
- **i18n scaffolding**: English + Hindi (हिन्दी) via `useI18n()` context + language toggle in kiosk and dashboard headers
- **Dark mode toggle**: `useTheme` context, `.dark` class on `<html>`, dark CSS vars on all pages
- **CORS regex**: backend allows `*.emergentagent.com` + localhost; frontend uses Bearer token only (ingress was forcing `*` in preflight which conflicts with credentials)

## What's been implemented — 2026-02-15

## Prioritized Backlog

### P1 (next iteration)
- Add server-side status-transition validation (reject illegal jumps)
- PIN-protect public POST /api/requests (require pin alongside room_id, or signed room token from /rooms/access)
- Scope analytics to user's department for non-admins
- Tighten CORS to explicit origin when credentials enabled
- Department CRUD UI page
- Custom escalation auto-flip via background job (currently computed client-side)

### P2 (future-ready modules from spec)
- Microsoft Teams / Slack / WhatsApp / Email notification integrations
- Food pre-ordering flow
- Visitor management
- Inventory consumption tracking
- IoT integrations (AC, lights)
- Voice assistant
- Calendar integrations
- Multi-language i18n
- Dark mode toggle
- PWA service worker + offline kiosk support

## Architecture (current)
- Frontend (React/CRA) → REACT_APP_BACKEND_URL/api/* → FastAPI server.py
- FastAPI app wrapped by socketio.ASGIApp at `/api/socket.io`
- MongoDB collections: users, rooms, categories, departments, routing_rules, requests
- Auth: httpOnly access_token cookie + Authorization Bearer fallback (12h expiry)
- Real-time: Socket.IO server emits, browser client subscribes on dashboard

## Test Credentials
See /app/memory/test_credentials.md
