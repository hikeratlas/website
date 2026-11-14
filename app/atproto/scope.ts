// Hiker Atlas's records (hikeratlas/atproto-lexicon; website#130).
// In beta: under .temp., so their schemas can still change (atproto's
// convention for records not yet committed to).
export const PROFILE = 'com.hikeratlas.temp.actor.profile';
export const FAVE = 'com.hikeratlas.temp.fave';
export const TRACK = 'com.hikeratlas.temp.track';
export const REVIEW = 'com.hikeratlas.temp.review';

// What signing in asks for: com.hikeratlas.authFull, Hiker Atlas's permission
// set (published from hikeratlas/atproto-lexicon), which covers writing these
// records in the user's own repository; and uploading files (GPX traces,
// photos), which no permission set can grant. A PDS shows the set's title
// and description when asking. New collections under com.hikeratlas.* (the
// stable names, too) are added to the published set, and need no new
// approval. The client metadata's scope is the most a sign-in may ask for:
// it changes with the sign-in's (both read this).
export const OAUTH_SCOPE = 'atproto include:com.hikeratlas.authFull blob:*/*';
