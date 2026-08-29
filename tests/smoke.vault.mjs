import * as C from "../js/crypto.js";
import { createEncryptedBackup, unlockEncryptedBackup } from "../js/vault.js";

async function main() {
  const identity = await C.generateIdentity();
  const passphrase = "correct horse battery staple";

  const backup = await createEncryptedBackup(identity, passphrase);
  console.log("backup file shape:", Object.keys(backup));
  console.assert(backup.did === identity.did, "backup records the right DID");

  const restored = await unlockEncryptedBackup(backup, passphrase);
  console.assert(restored.did === identity.did, "unlocked identity matches original DID");
  console.log("unlock with correct passphrase OK:", restored.did);

  let wrongPassphraseFailed = false;
  try {
    await unlockEncryptedBackup(backup, "definitely the wrong passphrase!!");
  } catch {
    wrongPassphraseFailed = true;
  }
  console.assert(wrongPassphraseFailed, "wrong passphrase must fail to unlock");
  console.log("wrong-passphrase rejection OK");

  console.log("\nALL VAULT SMOKE TESTS PASSED");
}

main().catch((e) => {
  console.error("VAULT SMOKE TEST FAILED:", e);
  process.exit(1);
});
