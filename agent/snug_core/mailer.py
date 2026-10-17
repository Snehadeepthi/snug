"""Welcome email for new Snug accounts, sent from our own server (Firebase's built-in templates can't be reworded).

Configure with environment variables (deploy.sh passes them through):
  SNUG_SMTP_USER  e.g. snug.team@gmail.com
  SNUG_SMTP_PASS  a Gmail App Password (Google Account -> Security -> 2-Step Verification -> App passwords)
  SNUG_SMTP_HOST  default smtp.gmail.com     SNUG_SMTP_PORT  default 587 (STARTTLS); 465 = SSL
"""
from __future__ import annotations

import html
import os
import smtplib
from email.message import EmailMessage

APP_URL = os.environ.get("SNUG_APP_URL", "https://snug-5zcsxlm5za-el.a.run.app/app/")


def configured() -> bool:
    return bool(os.environ.get("SNUG_SMTP_USER") and os.environ.get("SNUG_SMTP_PASS"))


def build_welcome(name: str, to: str) -> EmailMessage:
    n = html.escape(name)
    msg = EmailMessage()
    msg["Subject"] = f"Welcome to Snug, {name}! Your account is created"
    msg["From"] = f"Snug <{os.environ['SNUG_SMTP_USER']}>"
    msg["To"] = to
    msg.set_content(
        f"Hi {name},\n\nWelcome to Snug! Your account has been created.\n\n"
        "1. Scan your body once at home (in your everyday clothes).\n"
        "2. In the store, scan the barcode on any price tag.\n"
        "3. See instantly if it fits, and let Snug's AI get you the right size.\n\n"
        f"Open Snug: {APP_URL}\n\n"
        "Your body measurements stay on your phone. Your account stores only your name and email.\n\n"
        "The Snug team\n")
    msg.add_alternative(f"""\
<div style="font-family:Arial,sans-serif;max-width:520px;margin:auto;color:#2B2140">
  <div style="background:#2B2140;color:#fff;border-radius:16px;padding:24px">
    <div style="font-size:13px;letter-spacing:2px;opacity:.7">SNUG · FIT PASSPORT</div>
    <h1 style="margin:8px 0 4px;font-size:24px">Welcome to Snug, {n}!</h1>
    <div style="opacity:.85">Your account has been created.</div>
  </div>
  <ol style="line-height:1.7;padding-left:20px">
    <li><b>Scan your body once</b> at home, in your everyday clothes.</li>
    <li><b>Scan the barcode</b> on any price tag in the store.</li>
    <li><b>Know your size instantly</b>, and let Snug's AI fetch it for you.</li>
  </ol>
  <p><a href="{APP_URL}" style="background:#FF7A59;color:#fff;text-decoration:none;padding:12px 22px;border-radius:10px;display:inline-block;font-weight:bold">Open Snug</a></p>
  <p style="font-size:13px;color:#7a7385">🔒 Your body measurements stay on your phone. Your account stores only your name and email.</p>
  <p style="font-size:13px;color:#7a7385">The Snug team</p>
</div>""", subtype="html")
    return msg


def send(msg: EmailMessage) -> None:
    host = os.environ.get("SNUG_SMTP_HOST", "smtp.gmail.com")
    port = int(os.environ.get("SNUG_SMTP_PORT", "587"))
    user, pw = os.environ["SNUG_SMTP_USER"], os.environ["SNUG_SMTP_PASS"].replace(" ", "")
    if port == 465:
        with smtplib.SMTP_SSL(host, port, timeout=20) as s:
            s.login(user, pw); s.send_message(msg)
    else:
        with smtplib.SMTP(host, port, timeout=20) as s:
            s.starttls(); s.login(user, pw); s.send_message(msg)
