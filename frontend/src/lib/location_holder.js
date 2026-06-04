// Tiny module-level holder used by the axios interceptor to read
// the current super_admin's active location and role without
// creating a circular import between api.js and location.jsx.
//
// Synchronously hydrates from localStorage at module load so that the
// very first GET request after a page refresh is already scoped, before
// the React LocationProvider's effects have had a chance to run.

const STORAGE_KEY = "sw_active_location";
const ALL_LOCATIONS = "__all__";

function readInitial() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        // Sentinel means "no filter" → behave like null
        if (raw === ALL_LOCATIONS) return null;
        return raw || null;
    } catch {
        return null;
    }
}

let _activeLocationId = readInitial();
let _userRole = null;

export function getActiveLocationId() {
    return _activeLocationId;
}

export function setActiveLocationIdHolder(id) {
    _activeLocationId = id;
}

export function getUserRole() {
    return _userRole;
}

export function setUserRoleHolder(role) {
    _userRole = role;
}
