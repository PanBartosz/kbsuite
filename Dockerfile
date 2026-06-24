# syntax=docker/dockerfile:1

FROM node:24-slim

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

# Install dependencies
COPY package*.json ./
RUN npm ci

# Build the SvelteKit app
COPY . .
RUN npm run build

ENV NODE_ENV=production
EXPOSE 4173

# Run the built app
CMD ["npm", "run", "preview", "--", "--host", "0.0.0.0", "--port", "4173"]
