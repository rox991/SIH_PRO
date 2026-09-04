/**
 * Firestore security rules — emulator test suite.
 *
 * These rules are the only thing standing between a browser and other people's
 * medical records, so the invariants the README claims are asserted here rather
 * than argued for in prose.
 *
 * Not part of `npm test`: it needs the Firestore emulator and two packages that
 * nothing else in this repo uses.
 *
 *   npm i --no-save @firebase/rules-unit-testing firebase
 *   npx firebase-tools emulators:exec --only firestore \
 *     "node test/firestore-rules.test.mjs"
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  initializeTestEnvironment, assertSucceeds, assertFails
} from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc, deleteDoc, collection, getDocs, query, where } from "firebase/firestore";

const env = await initializeTestEnvironment({
  projectId: "sihicd11-rules-test",
  firestore: { host: "127.0.0.1", port: 8080, rules: readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "firestore.rules"), "utf8") }
});

// The emulator keeps data between runs, and several rules compare a field to
// its stored value, so the suite has to start from an empty database.
await env.clearFirestore();

let pass = 0, fail = 0;
async function t(name, fn) {
  try { await fn(); console.log("  ok   " + name); pass++; }
  catch (e) { console.log("  FAIL " + name + "\n       " + (e.message || e).split("\n")[0]); fail++; }
}

const PATIENT = "uid-patient", PATIENT2 = "uid-patient2", INSURER = "uid-insurer", INSURER2 = "uid-insurer2", HOSP = "uid-hospital";
const ABHA = "91482139201102", ABHA2 = "91482139209999";
const INS = "INS-AAAAAA", INS2 = "INS-BBBBBB", HIP = "HIP-CCCCCC";
const POL = "BAGIHLT2026004821";

// Seed the ownership documents the rules read, bypassing rules to do it.
await env.withSecurityRulesDisabled(async (ctx) => {
  const db = ctx.firestore();
  await setDoc(doc(db, "abha", ABHA), { ownerUid: PATIENT, abhaNumber: ABHA, fullName: "Anjali R. Deshmukh" });
  await setDoc(doc(db, "abha", ABHA2), { ownerUid: PATIENT2, abhaNumber: ABHA2, fullName: "Other Person" });
  await setDoc(doc(db, "insurers", INS), { ownerUid: INSURER, insurerId: INS, name: "Bharat Arogya" });
  await setDoc(doc(db, "insurers", INS2), { ownerUid: INSURER2, insurerId: INS2, name: "Rival Insurance" });
  await setDoc(doc(db, "hips", HIP), { ownerUid: HOSP, hipId: HIP, name: "Sushruta Ayurveda" });
});

const patient  = env.authenticatedContext(PATIENT).firestore();
const patient2 = env.authenticatedContext(PATIENT2).firestore();
const insurer  = env.authenticatedContext(INSURER).firestore();
const insurer2 = env.authenticatedContext(INSURER2).firestore();
const hospital = env.authenticatedContext(HOSP).firestore();
const anon     = env.unauthenticatedContext().firestore();

const policyRecord = {
  policyKey: POL, policyNumber: "BAGI-HLT-2026-004821", insurerId: INS, insurerName: "Bharat Arogya",
  abhaKey: ABHA, abhaAddress: "anjali@sbx", patientUid: PATIENT,
  memberNameMasked: "A***** R. D*******", status: "ACTIVE"
};

console.log("\nusers / roles");
await t("a browser may claim role 'insurer'", () =>
  assertSucceeds(setDoc(doc(patient, "users", PATIENT), { email: "a@b.c", role: "insurer" })));
await t("a browser still may not claim role 'admin'", () =>
  assertFails(setDoc(doc(patient, "users", PATIENT), { email: "a@b.c", role: "admin" })));

console.log("\ninsurers / insurerDirectory");
await t("insurer reads its own registration", () =>
  assertSucceeds(getDoc(doc(insurer, "insurers", INS))));
await t("a rival insurer cannot read that registration (holds the API key hash)", () =>
  assertFails(getDoc(doc(insurer2, "insurers", INS))));
await t("a patient cannot read an insurer registration", () =>
  assertFails(getDoc(doc(patient, "insurers", INS))));
await t("insurer publishes itself to the public directory", () =>
  assertSucceeds(setDoc(doc(insurer, "insurerDirectory", INS), { insurerId: INS, name: "Bharat Arogya", ownerUid: INSURER, status: "ACTIVE" })));
await t("a patient can list the insurer directory to pick one", () =>
  assertSucceeds(getDocs(collection(patient, "insurerDirectory"))));
await t("an insurer cannot publish a directory entry it does not own", () =>
  assertFails(setDoc(doc(insurer2, "insurerDirectory", "INS-FORGED"), { insurerId: "INS-FORGED", name: "x", ownerUid: INSURER, status: "ACTIVE" })));

console.log("\npolicyDirectory - linking");
await t("patient links a policy to their own ABHA", () =>
  assertSucceeds(setDoc(doc(patient, "policyDirectory", POL), policyRecord)));
await t("another patient cannot hijack a policy number already linked", () =>
  assertFails(setDoc(doc(patient2, "policyDirectory", POL), { ...policyRecord, abhaKey: ABHA2, patientUid: PATIENT2 })));
await t("patient cannot link a policy to an ABHA that is not theirs", () =>
  assertFails(setDoc(doc(patient2, "policyDirectory", "OTHERPOLICY123"), { ...policyRecord, policyKey: "OTHERPOLICY123", abhaKey: ABHA, patientUid: PATIENT2 })));
await t("an insurer cannot attach a policy to an ABHA itself", () =>
  assertFails(setDoc(doc(insurer, "policyDirectory", "INSURERMADE123"), { ...policyRecord, policyKey: "INSURERMADE123" })));
await t("patient may correct their own entry", () =>
  assertSucceeds(setDoc(doc(patient, "policyDirectory", POL), { ...policyRecord, planName: "Arogya Sanjeevani" })));
await t("patient cannot move their entry to another ABHA", () =>
  assertFails(setDoc(doc(patient, "policyDirectory", POL), { ...policyRecord, abhaKey: ABHA2 })));

console.log("\npolicyDirectory - lookup");
await t("the issuing insurer resolves the policy number", () =>
  assertSucceeds(getDoc(doc(insurer, "policyDirectory", POL))));
await t("the policyholder can read their own entry", () =>
  assertSucceeds(getDoc(doc(patient, "policyDirectory", POL))));
await t("a rival insurer cannot resolve it", () =>
  assertFails(getDoc(doc(insurer2, "policyDirectory", POL))));
await t("a hospital cannot resolve a policy number", () =>
  assertFails(getDoc(doc(hospital, "policyDirectory", POL))));
await t("an anonymous visitor cannot resolve a policy number", () =>
  assertFails(getDoc(doc(anon, "policyDirectory", POL))));
await t("nobody may enumerate the whole policy directory", () =>
  assertFails(getDocs(collection(insurer, "policyDirectory"))));
await t("an unregistered policy number is refused, not answered", () =>
  assertFails(getDoc(doc(insurer, "policyDirectory", "NEVERISSUED999"))));

console.log("\npatientPolicies - the patient's private list");
await t("patient writes their own list entry", () =>
  assertSucceeds(setDoc(doc(patient, "patientPolicies", ABHA + "__" + POL), { ...policyRecord, _parent: ABHA, _key: POL })));
await t("patient lists their own policies", () =>
  assertSucceeds(getDocs(query(collection(patient, "patientPolicies"), where("_parent", "==", ABHA)))));
await t("an insurer cannot enumerate a patient's policies", () =>
  assertFails(getDocs(query(collection(insurer, "patientPolicies"), where("_parent", "==", ABHA)))));
await t("another patient cannot write into that list", () =>
  assertFails(setDoc(doc(patient2, "patientPolicies", ABHA + "__X"), { _parent: ABHA, _key: "X" })));

console.log("\nconsents raised by an insurer");
const CID = "consent-insurer-1";
const claim = {
  consentId: CID, requesterUid: INSURER, requesterType: "INSURER",
  hipId: INS, hipName: "Bharat Arogya", insurerId: INS, insurerName: "Bharat Arogya",
  policyKey: POL, policyNumber: "BAGI-HLT-2026-004821", claimRef: "CLM-2026-88213",
  patientUid: PATIENT, abhaKey: ABHA, abhaAddress: "anjali@sbx",
  purposeCode: "HPAYMT", hiTypes: "OPConsultation,Prescription",
  status: "REQUESTED", dateFrom: "2026-01-01", dateTo: "2026-09-05", expiryAt: 4102444800000
};
await t("insurer raises a claim consent request", () =>
  assertSucceeds(setDoc(doc(insurer, "consents", CID), claim)));
await t("a rival insurer cannot raise one in that insurer's name", () =>
  assertFails(setDoc(doc(insurer2, "consents", "consent-forged"), { ...claim, consentId: "consent-forged", requesterUid: INSURER2 })));
await t("a patient cannot forge an insurer's consent request", () =>
  assertFails(setDoc(doc(patient, "consents", "consent-forged-2"), { ...claim, consentId: "consent-forged-2", requesterUid: PATIENT })));
await t("a hospital consent request still works", () =>
  assertSucceeds(setDoc(doc(hospital, "consents", "consent-hip-1"), {
    consentId: "consent-hip-1", requesterUid: HOSP, hipId: HIP, hipName: "Sushruta Ayurveda",
    patientUid: PATIENT, abhaKey: ABHA, purposeCode: "CAREMGT", hiTypes: "OPConsultation",
    status: "REQUESTED", dateFrom: "2026-01-01", dateTo: "2026-09-05", expiryAt: 4102444800000
  })));
await t("insurer cannot self-grant its own request", () =>
  assertFails(setDoc(doc(insurer, "consents", CID), { ...claim, status: "GRANTED" })));
await t("hospital cannot self-grant its own request either", () =>
  assertFails(setDoc(doc(hospital, "consents", "consent-hip-1"), {
    consentId: "consent-hip-1", requesterUid: HOSP, hipId: HIP, hipName: "Sushruta Ayurveda",
    patientUid: PATIENT, abhaKey: ABHA, purposeCode: "CAREMGT", hiTypes: "OPConsultation",
    status: "GRANTED", dateFrom: "2026-01-01", dateTo: "2026-09-05", expiryAt: 4102444800000
  })));
await t("the requesting insurer may still revoke its own request", () =>
  assertSucceeds(setDoc(doc(insurer, "consents", CID), { ...claim, status: "REVOKED" })));
await t("the patient grants the request", async () => {
  await env.withSecurityRulesDisabled(async (ctx) => setDoc(doc(ctx.firestore(), "consents", CID), claim));
  await assertSucceeds(setDoc(doc(patient, "consents", CID), { ...claim, status: "GRANTED", disclosedCount: 1 }));
});
await t("the patient may revoke it afterwards", () =>
  assertSucceeds(setDoc(doc(patient, "consents", CID), { ...claim, status: "REVOKED" })));

console.log("\ninsurerConsents index");
await t("insurer files the index entry for its own request", () =>
  assertSucceeds(setDoc(doc(insurer, "insurerConsents", INS + "__" + CID), { _parent: INS, _key: CID, ts: 1 })));
await t("index entry cannot be filed under another insurer", () =>
  assertFails(setDoc(doc(insurer, "insurerConsents", INS2 + "__" + CID), { _parent: INS2, _key: CID, ts: 1 })));
await t("insurer lists its own claim requests", () =>
  assertSucceeds(getDocs(query(collection(insurer, "insurerConsents"), where("_parent", "==", INS)))));
await t("a rival insurer cannot list them", () =>
  assertFails(getDocs(query(collection(insurer2, "insurerConsents"), where("_parent", "==", INS)))));

await env.withSecurityRulesDisabled(async (ctx) => setDoc(doc(ctx.firestore(), "consents", CID), { ...claim, status: "GRANTED" }));

console.log("\ndisclosures under a claim consent");
await t("the patient writes the disclosure payload", () =>
  assertSucceeds(setDoc(doc(patient, "disclosures", CID), { rec1: { display: "Amlapitta", hiType: "OPConsultation" } })));
await t("the requesting insurer reads it", () =>
  assertSucceeds(getDoc(doc(insurer, "disclosures", CID))));
await t("a rival insurer cannot read it", () =>
  assertFails(getDoc(doc(insurer2, "disclosures", CID))));
await t("a hospital cannot read a claim disclosure", () =>
  assertFails(getDoc(doc(hospital, "disclosures", CID))));
await t("the insurer cannot alter what was disclosed to it", () =>
  assertFails(setDoc(doc(insurer, "disclosures", CID), { rec1: { display: "tampered" } })));
await t("the patient can withdraw the payload", () =>
  assertSucceeds(deleteDoc(doc(patient, "disclosures", CID))));

console.log("\nunlinking");
await t("patient unlinks their own policy", () =>
  assertSucceeds(deleteDoc(doc(patient, "policyDirectory", POL))));
await t("an insurer cannot delete a policy link", async () => {
  await env.withSecurityRulesDisabled(async (ctx) => setDoc(doc(ctx.firestore(), "policyDirectory", POL), policyRecord));
  await assertFails(deleteDoc(doc(insurer, "policyDirectory", POL)));
});

await env.cleanup();
console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
