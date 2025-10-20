FROM node:20-slim

WORKDIR /app

# Copy everything (dist, node_modules, package.json all pre-built)
COPY . .

# Expose port
ENV PORT=8080
EXPOSE 8080

# Start the service
CMD ["npm", "start"]
