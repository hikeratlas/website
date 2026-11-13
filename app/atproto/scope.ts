// What Hiker Atlas asks to do in your account: write its own records (your
// profile on it, your faves), and nothing else (not post to Bluesky, not read
// anything private).
// In beta: under .temp., so their schemas can still change (atproto's
// convention for records not yet committed to; website#130).
export const FAVE = 'com.hikeratlas.temp.fave';
export const PROFILE = 'com.hikeratlas.temp.actor.profile';
export const OAUTH_SCOPE = `atproto repo?collection=${PROFILE}&collection=${FAVE}`;
