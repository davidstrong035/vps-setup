# Mass Mailer Backend

## Overview

This is the backend service for the Mass Mailer platform. It provides RESTful APIs, campaign management, domain rotation, email dispatch, user management, and admin controls for high-volume, compliant email delivery.

---

## Features

- User authentication and authorization (JWT)
- Campaign creation, scheduling, and tracking
- Dynamic sending domain rotation with reputation and quota management
- Dead letter queue (DLQ) for failed jobs and admin review
- Rate limiting and quota enforcement (global, per-user, per-domain)
- AWS SES and S3 integration
- Admin dashboard APIs for system health, logs, and settings
- Audit logging and error handling
- Scalable queue-based email dispatch (BullMQ, Redis)

---

## Tech Stack

- Node.js, Express.js
- TypeScript
- MongoDB (Mongoose)
- Redis (BullMQ)
- AWS SES, S3
- Nodemailer, Winston (logging)

---

## Project Structure

```
backend/
  src/
    app.ts              # Express app setup
    server.ts           # Server entry point
    config/             # DB, Redis, SES, S3 configs
    controllers/        # Route controllers
    middleware/         # Auth, error, request context
    models/             # Mongoose models
    queue/              # BullMQ queues and workers
    routes/             # Express routes
    services/           # Business logic/services
    types/              # TypeScript types
    utils/              # Utilities (logger, etc.)
  scripts/              # Utility scripts
  dist/                 # Compiled output
  .env.example          # Example environment variables
```

---

## Setup & Development

1. **Clone the repo:**
   ```sh
   git clone <your-repo-url>
   cd backend
   ```
2. **Install dependencies:**
   ```sh
   npm install
   ```
3. **Configure environment:**
   - Copy `.env.example` to `.env` and fill in your secrets (MongoDB, Redis, AWS, JWT, etc).
4. **Run in development:**
   ```sh
   npm run dev
   ```
5. **Build for production:**
   ```sh
   npm run build
   ```
6. **Start in production:**
   ```sh
   npm start
   ```

---

## Environment Variables

See `.env.example` for all required variables:

- `MONGODB_URI`, `REDIS_URL`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`, `SES_FROM_EMAIL`, etc.

---

## API Endpoints

- `/auth/*` — Authentication (login, register, etc)
- `/campaigns/*` — Campaign management
- `/domains/*` — Sending domain management
- `/admin/*` — Admin dashboard APIs (logs, limits, DLQ, etc)
- `/lists/*`, `/subscribers/*`, `/templates/*`, `/webhooks/*` — List, subscriber, template, and webhook management

See the [EMAIL_SYSTEM_OVERVIEW.md](../EMAIL_SYSTEM_OVERVIEW.md) for detailed API and system flow documentation.

---

## Deployment

- Recommended: Deploy on AWS EC2, Docker, or similar.
- Requires MongoDB, Redis, and AWS SES/S3 credentials.
- Use a process manager (e.g., pm2) for production.
- Set up HTTPS and firewall rules for security.

---

## Contributing

1. Fork the repo and create a feature branch.
2. Follow code style and TypeScript best practices.
3. Add/modify tests if needed.
4. Submit a pull request with a clear description.

---

## License

[MIT](../LICENSE)

---

## Contact

For questions or support, contact the engineering team or open an issue in the repository.
