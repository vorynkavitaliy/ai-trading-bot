FROM python:3.9-slim

# Set working directory
WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y \
    gcc \
    g++ \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements first for better caching
COPY requirements.txt .

# Install Python dependencies
RUN pip install --no-cache-dir -r requirements.txt

# Copy source code
COPY src/ ./src/
COPY main.py .
COPY config/ ./config/

# Create directories for logs and data
RUN mkdir -p logs data

# Set environment variables
ENV PYTHONPATH=/app/src
ENV PYTHONUNBUFFERED=1

# Create non-root user
RUN useradd -m -u 1000 trading-bot && \
    chown -R trading-bot:trading-bot /app
USER trading-bot

# Expose port for potential web interface
EXPOSE 8000

# Default command
CMD ["python", "main.py", "--mode", "paper"]