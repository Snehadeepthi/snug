// Snug sign in / sign up with Firebase Authentication: phone number (SMS OTP) or email + password.
// The account stores only name and phone/email. Body measurements never leave the phone.
// Needs web/firebase-config.json (see README). Without it, Snug runs in guest mode.
import {
  initializeApp, getAuth, onAuthStateChanged, signOut, updateProfile, RecaptchaVerifier, signInWithPhoneNumber,
  createUserWithEmailAndPassword, signInWithEmailAndPassword, sendPasswordResetEmail, sendEmailVerification, setPersistence,
  browserLocalPersistence, useDeviceLanguage,
} from "../vendor/firebase-auth.bundle.mjs";

const $ = (s) => document.querySelector(s);
const state = { auth: null, configured: false, user: null, confirmation: null, verifier: null, resendTimer: null };

const ERRORS = {
  "auth/invalid-phone-number": "That phone number doesn't look right. Include the full number without the leading 0.",
  "auth/too-many-requests": "Too many attempts. Please wait a few minutes and try again.",
  "auth/invalid-verification-code": "That code isn't right. Check the SMS and try again.",
  "auth/code-expired": "That code has expired. Tap Resend to get a new one.",
  "auth/quota-exceeded": "SMS limit reached for now. Please use email, or continue as guest.",
  "auth/captcha-check-failed": "Security check failed. Reload the page and try again.",
  "auth/email-already-in-use": "An account with this email already exists. Try signing in instead.",
  "auth/invalid-email": "Please enter a valid email address.",
  "auth/weak-password": "Please use a password with at least 6 characters.",
  "auth/invalid-credential": "Email or password is incorrect.",
  "auth/wrong-password": "Email or password is incorrect.",
  "auth/user-not-found": "No account with this email. Create one instead.",
  "auth/missing-password": "Please enter your password.",
  "auth/network-request-failed": "No internet connection. Please try again.",
  "auth/operation-not-allowed": "We can't send an SMS to this number right now. Please sign in with Email, or continue as guest.",
  "auth/billing-not-enabled": "SMS sign-in isn't available right now. Please sign in with Email, or continue as guest.",
  "auth/invalid-app-credential": "Security check failed. Reload the page and try again.",
  "auth/unauthorized-domain": "This web address isn't allowed to sign in yet (add it in Firebase → Authentication → Settings).",
};
// Friendly text plus Firebase's code in brackets, so a failed sign-in can be diagnosed from a screenshot.
const friendly = (e) => (ERRORS[e?.code] || (e?.message || "Something went wrong.").replace("Firebase: ", "")) + (e?.code ? ` [${e.code}]` : "");
function msg(id, text, ok = false) { const el = $(id); el.textContent = text || ""; el.classList.toggle("hidden", !text); el.classList.toggle("okmsg", ok); }
function busy(btn, on, label) { btn.disabled = on; if (label) btn.textContent = on ? "Please wait…" : label; }
const emit = (name) => window.dispatchEvent(new CustomEvent(name, { detail: { user: state.user } }));
const summary = (u) => u ? { uid: u.uid, name: u.displayName || "", phone: u.phoneNumber || "", email: u.email || "" } : null;

async function init() {
  let cfg = null;
  try { const r = await fetch("firebase-config.json", { cache: "no-store" }); if (r.ok) cfg = await r.json(); } catch {}
  if (!cfg?.apiKey || String(cfg.apiKey).startsWith("PASTE")) {
    $("#authNotConfigured").classList.remove("hidden"); $("#authForms").classList.add("hidden");
    window.SnugAuth.ready = true; emit("snug-auth-changed"); return;
  }
  const app = initializeApp(cfg);
  state.auth = getAuth(app); state.configured = true; useDeviceLanguage(state.auth);
  await setPersistence(state.auth, browserLocalPersistence).catch(() => {});
  onAuthStateChanged(state.auth, (u) => { state.user = summary(u); window.SnugAuth.user = state.user; window.SnugAuth.ready = true; emit("snug-auth-changed"); });
}

// ---------- phone OTP ----------
function verifier() {
  if (!state.verifier) state.verifier = new RecaptchaVerifier(state.auth, "recaptcha", { size: "invisible" });
  return state.verifier;
}
function startResendCountdown() {
  clearInterval(state.resendTimer); let n = 30; const b = $("#resendOtp"); b.disabled = true;
  state.resendTimer = setInterval(() => { b.textContent = n > 0 ? `Resend in ${n--}s` : "Resend code"; if (n < 0) { clearInterval(state.resendTimer); b.disabled = false; } }, 1000);
}
async function sendOtp() {
  msg("#phoneErr", "");
  const digits = $("#phoneNumber").value.replace(/\D/g, "").replace(/^0+/, "");
  if (digits.length < 6) { msg("#phoneErr", "Please enter your mobile number."); return; }
  const full = $("#phoneCountry").value + digits;
  const b = $("#sendOtp"); busy(b, true, "Send OTP");
  try {
    state.confirmation = await signInWithPhoneNumber(state.auth, full, verifier());
    $("#otpSentTo").textContent = full; $("#phoneStep1").classList.add("hidden"); $("#phoneStep2").classList.remove("hidden");
    $("#otpCode").value = ""; $("#otpCode").focus(); startResendCountdown();
  } catch (e) {
    msg("#phoneErr", friendly(e)); console.warn("Phone sign-in failed:", e?.code, e?.message);
    try { state.verifier?.clear(); } catch {} state.verifier = null; $("#recaptcha").innerHTML = "";   // fresh security check on retry
  }
  busy(b, false, "Send OTP");
}
async function verifyOtp() {
  msg("#otpErr", "");
  const code = $("#otpCode").value.replace(/\D/g, "");
  if (code.length !== 6) { msg("#otpErr", "Enter the 6-digit code from the SMS."); return; }
  const b = $("#verifyOtp"); busy(b, true, "Verify & continue");
  try {
    const cred = await state.confirmation.confirm(code);
    if (!cred.user.displayName) { $("#phoneStep2").classList.add("hidden"); $("#nameStep").classList.remove("hidden"); $("#newName").focus(); }
    else done();
  } catch (e) { msg("#otpErr", friendly(e)); }
  busy(b, false, "Verify & continue");
}
async function saveName() {
  const name = $("#newName").value.trim(); if (!name) { $("#newName").focus(); return; }
  try { await updateProfile(state.auth.currentUser, { displayName: name }); state.user = summary(state.auth.currentUser); window.SnugAuth.user = state.user; } catch {}
  done();
}

// ---------- email + password ----------
let emailMode = "signin";
function setEmailMode(m) {
  emailMode = m;
  document.querySelectorAll("[data-email-mode]").forEach((b) => b.classList.toggle("active", b.dataset.emailMode === m));
  $("#signupOnly").classList.toggle("hidden", m !== "signup"); $("#confirmWrap").classList.toggle("hidden", m !== "signup");
  $("#emailGo").textContent = m === "signup" ? "Create account" : "Sign in";
  $("#forgotPw").classList.toggle("hidden", m !== "signin"); msg("#emailErr", "");
}
async function emailGo() {
  msg("#emailErr", "");
  const email = $("#email").value.trim(), pw = $("#password").value;
  const b = $("#emailGo"), label = b.textContent; busy(b, true, label);
  try {
    if (emailMode === "signup") {
      const name = $("#signupName").value.trim();
      if (!name) throw { message: "Please enter your name." };
      if (pw !== $("#password2").value) throw { message: "Passwords don't match." };
      const cred = await createUserWithEmailAndPassword(state.auth, email, pw);
      await updateProfile(cred.user, { displayName: name });
      state.user = summary(state.auth.currentUser); window.SnugAuth.user = state.user;
      // Account-created email, sent by Firebase (no mail server needed). Its subject/text is set in
      // Firebase console -> Authentication -> Templates -> Email address verification (see README).
      try {
        await sendEmailVerification(cred.user, { url: new URL("./", location.href).href });
        window.SnugAuth.welcome = { name, email };
      } catch (err) { console.warn("Welcome email not sent:", err?.code); window.SnugAuth.welcome = { name, email, failed: true }; }
    } else {
      await signInWithEmailAndPassword(state.auth, email, pw);
    }
    done();
  } catch (e) { msg("#emailErr", friendly(e)); }
  busy(b, false, label);
}
async function forgot() {
  const email = $("#email").value.trim();
  if (!email) { msg("#emailErr", "Enter your email above, then tap Forgot password."); return; }
  try { await sendPasswordResetEmail(state.auth, email); msg("#emailErr", "Password reset email sent. Check your inbox.", true); }
  catch (e) { msg("#emailErr", friendly(e)); }
}

function done() { emit("snug-auth-changed"); window.dispatchEvent(new CustomEvent("snug-auth-done")); resetForms(); }
function resetForms() {
  $("#phoneStep1").classList.remove("hidden"); $("#phoneStep2").classList.add("hidden"); $("#nameStep").classList.add("hidden");
  ["#phoneNumber", "#otpCode", "#password", "#password2"].forEach((s) => ($(s).value = ""));
}

// ---------- wire up ----------
document.querySelectorAll("[data-auth-tab]").forEach((b) => b.addEventListener("click", () => {
  document.querySelectorAll("[data-auth-tab]").forEach((x) => x.classList.toggle("active", x === b));
  $("#authPhone").classList.toggle("hidden", b.dataset.authTab !== "phone"); $("#authEmail").classList.toggle("hidden", b.dataset.authTab !== "email");
}));
document.querySelectorAll("[data-email-mode]").forEach((b) => b.addEventListener("click", () => setEmailMode(b.dataset.emailMode)));
$("#sendOtp").addEventListener("click", sendOtp);
$("#resendOtp").addEventListener("click", sendOtp);
$("#changeNumber").addEventListener("click", () => { $("#phoneStep2").classList.add("hidden"); $("#phoneStep1").classList.remove("hidden"); });
$("#verifyOtp").addEventListener("click", verifyOtp);
$("#otpCode").addEventListener("input", (e) => { if (e.target.value.replace(/\D/g, "").length === 6) verifyOtp(); });
$("#saveName").addEventListener("click", saveName);
$("#emailGo").addEventListener("click", emailGo);
$("#forgotPw").addEventListener("click", forgot);
setEmailMode("signin");

window.SnugAuth = {
  ready: false, user: null,
  get configured() { return state.configured; },
  signOut: async () => { if (state.auth) await signOut(state.auth); state.user = null; window.SnugAuth.user = null; emit("snug-auth-changed"); },
};
init();
