# Chromium image/version must match browser-worker/package.json.
# This is a LOCAL service, not an Internet-facing hosted browser.
FROM mcr.microsoft.com/playwright:v1.64.0-noble

RUN apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
    xvfb x11vnc novnc websockify x11-utils \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /home/pwuser/app
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund \
    && mkdir -p /home/pwuser/browser-data/default /tmp/.X11-unix \
    && chmod 1777 /tmp/.X11-unix \
    && chown -R pwuser:pwuser /home/pwuser
COPY src ./src
COPY scripts ./scripts
RUN chmod 755 ./scripts/start.sh && chown -R pwuser:pwuser ./src ./scripts
USER pwuser
ENV DISPLAY=:99 BROWSER_WORKER_PORT=4300 BROWSER_PROFILE_DIR=/home/pwuser/browser-data/default
EXPOSE 4300 6080
CMD ["sh", "./scripts/start.sh"]
