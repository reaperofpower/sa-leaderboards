# Use the official, lightweight Node.js image
FROM node:20-alpine

# Create and set the working directory inside the container
WORKDIR /usr/src/app

# Copy the package.json and install dependencies
# We do this before copying the rest of the code to leverage Docker layer caching
COPY package.json ./
RUN npm install

# Copy the rest of your application code
COPY . .

# Expose the port the app runs on
EXPOSE 3000

# Command to run the application
CMD [ "npm", "start" ]
