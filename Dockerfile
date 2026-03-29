FROM node:20-alpine AS build
WORKDIR /app
COPY package.json vite.config.js ./
COPY src ./src
COPY index.html ./
COPY public ./public
RUN npm install
RUN npm run build

FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY server.cjs ./server.cjs
EXPOSE 3000
CMD ["sh","-c","node server.cjs"]