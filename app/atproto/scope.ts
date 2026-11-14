// Hiker Atlas's records (lexicons/com/hikeratlas/temp/*.json; website#130).
// In beta: under .temp., so their schemas can still change (atproto's
// convention for records not yet committed to).
export const PROFILE = 'com.hikeratlas.temp.actor.profile';
export const FAVE = 'com.hikeratlas.temp.fave';
export const TRACK = 'com.hikeratlas.temp.track';
export const REVIEW = 'com.hikeratlas.temp.review';

// What signing in asks for: writing these records in the user's own
// repository, and uploading files (GPX traces, photos), which no permission
// set can grant. Tracks and reviews are asked for now, though the site
// doesn't write them yet, so nobody is asked again when it does.
//
// Once the lexicons are published (lexicons/README.md), the repo: parts
// become include:com.hikeratlas.authFull, a permission set: new collections
// under com.hikeratlas.* (the stable names, too) then need no new approval.
// The client metadata's scope is the most a sign-in may ask for, so it must
// change before (or with) the sign-in's.
export const OAUTH_SCOPE = ['atproto', ...[PROFILE, FAVE, TRACK, REVIEW].map((c) => `repo:${c}`), 'blob:*/*'].join(' ');
