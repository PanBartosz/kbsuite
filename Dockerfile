# syntax=docker/dockerfile:1

FROM node:20-slim

WORKDIR /app

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
