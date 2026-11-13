// What Hiker Atlas asks to do in your account: write its own records (your
// profile on it, your faves), and nothing else (not post to Bluesky, not read
// anything private).
export const FAVE = 'com.hikeratlas.fave';
export const PROFILE = 'com.hikeratlas.actor.profile';
export const OAUTH_SCOPE = `atproto repo?collection=${PROFILE}&collection=${FAVE}`;
