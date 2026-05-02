# Security Policy

This is an educational project. Do not assume the default configuration is production-ready for every environment.

## Supported Versions

Security fixes are expected to target the current `main` or `master` branch until a formal release process exists.

## Reporting a Vulnerability

If you find a vulnerability, open a private report if the GitHub repository has private vulnerability reporting enabled. If it does not, contact the repository owner directly before publishing details.

Do not include real tokens, `.env` contents, private database dumps or visitor data in public issues.

## Deployment Notes

- Use HTTPS in production.
- Restrict `ALLOWED_ORIGINS` to trusted domains.
- Keep `.env`, SQLite data and uploads out of Git.
- Use strong credentials for the admin panel and Telegram bot.
- Review firewall, proxy and Docker settings before public deployment.
