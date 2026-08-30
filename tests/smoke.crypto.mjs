import * as C from "../js/crypto.js";

async function main() {
  // 1. Fresh identity + did:key shape
  const id = await C.generateIdentity();
  console.assert(id.did.startsWith("did:key:z6Mk"), "did prefix");
  console.assert(id.did.length === "did:key:".length + 48, "did length");
  console.log("DID:", id.did);

  // 2. Sign + verify a lobby message
  const { normalized, payload } = C.messagePayload("lobby", C.nextNonce(), "  Hello\u200bTechnocore\u2028 world  ");
  console.log("normalized:", JSON.stringify(normalized));
  const sig = await C.signBytes(id.privateKey, payload);
  console.assert(sig.length === 86, "sig length 86");
  await C.verifyBytes(id.did, sig, payload); // throws on failure
  console.log("verify OK");

  // 3. Seed export -> hex -> reimport -> same DID
  const seed = await C.exportSeed(id.privateKey);
  const hex = C.seedToHex(seed);
  console.assert(hex.length === 64, "hex seed length 64");
  const restored = await C.identityFromSeed(C.seedFromHex(hex));
  console.assert(restored.did === id.did, "restored DID matches original: " + restored.did + " vs " + id.did);
  console.log("seed round-trip OK, restored DID matches");

  // 4. did:key <-> raw public key round trip
  const pkBytes = C.publicKeyBytesFromDid(id.did);
  const did2 = C.didFromPublicKeyBytes(pkBytes);
  console.assert(did2 === id.did, "did round-trip via pubkey bytes");

  // 5. base58btc round trip on random bytes
  const rnd = crypto.getRandomValues(new Uint8Array(34));
  const enc = C.base58btcEncode(rnd);
  const dec = C.base58btcDecode(enc);
  console.assert(C.bytesToHex(dec) === C.bytesToHex(rnd), "base58btc round trip");

  // 6. Contribution proof create + verify
  const proof = await C.createContributionProof(
    id.privateKey,
    id.did,
    "https://github.com/example/repo",
    "a".repeat(40)
  );
  await C.verifyContributionProof(proof); // throws on failure
  console.log("contribution proof verify OK:", JSON.stringify(proof, null, 2));

  // 7. Tampered proof must fail
  let failed = false;
  try {
    await C.verifyContributionProof({ ...proof, commit: "b".repeat(40) });
  } catch {
    failed = true;
  }
  console.assert(failed, "tampered proof should fail verification");

  // 8. Nonces must stay within JavaScript's safe integer range so they
  // round-trip losslessly through any standard JSON parser (a ~19-digit
  // nanosecond-scale nonce previously caused real false-mismatch failures
  // against the live server — see README §4a).
  for (let i = 0; i < 5; i++) {
    const n = C.nextNonce();
    console.assert(
      Number.isSafeInteger(Number(n)),
      `nonce ${n} exceeds Number.MAX_SAFE_INTEGER and would round-trip corrupted through JSON`
    );
  }
  console.log("nonce safe-integer check OK");

  // Simulate exactly what broke live: a server echoing the nonce back as a
  // bare JSON number (not a string), round-tripped through the browser's
  // own JSON.parse. With the old nanosecond-scale nonce this silently
  // corrupted the value; with the millisecond-scale nonce it must not.
  const n2 = C.nextNonce();
  const simulatedServerJson = `{"nonce": ${n2}}`;
  const roundTripped = JSON.parse(simulatedServerJson).nonce;
  console.assert(
    String(roundTripped) === n2,
    `nonce ${n2} was corrupted to ${roundTripped} after a JSON number round trip`
  );
  console.log("JSON-number round-trip fidelity OK:", n2, "->", roundTripped);

  console.log("\nALL SMOKE TESTS PASSED");
}

main().catch((e) => {
  console.error("SMOKE TEST FAILED:", e);
  process.exit(1);
});
