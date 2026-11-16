import { describe, expect, it } from 'vitest';
import { photoUrl } from './indexer';

const DID = 'did:plc:aaaaaaaaaaaaaaaaaaaaaaaa';
const CID = 'bafkreibme22gw2h7y2h7tg2fhqotaqjucnbc24deqo72b6mkl2egezxhvy';

describe('photoUrl (#177)', () => {
  it("is the indexer's getPhoto, a thumbnail unless asked otherwise", () => {
    expect(photoUrl(DID, CID)).toBe(`https://indexer.hikeratlas.com/xrpc/com.hikeratlas.temp.getPhoto?did=${encodeURIComponent(DID)}&cid=${CID}`);
    expect(photoUrl(DID, CID, 'fullsize')).toBe(`https://indexer.hikeratlas.com/xrpc/com.hikeratlas.temp.getPhoto?did=${encodeURIComponent(DID)}&cid=${CID}&size=fullsize`);
  });
});
