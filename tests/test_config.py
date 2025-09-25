"""Tests for configuration module."""

import pytest
import tempfile
import os
from pathlib import Path

from src.ai_trading_bot.core.config import Config


def test_config_creation():
    """Test basic config creation."""
    config_dict = {
        "trading": {
            "symbols": ["BTCUSDT"],
            "initial_balance": 1000
        }
    }
    
    config = Config(config_dict)
    assert config.get("trading.symbols") == ["BTCUSDT"]
    assert config.get("trading.initial_balance") == 1000


def test_config_from_path():
    """Test loading config from file."""
    with tempfile.NamedTemporaryFile(mode='w', suffix='.yaml', delete=False) as f:
        f.write("""
trading:
  symbols: ["BTCUSDT", "ETHUSDT"]
  initial_balance: 5000
data:
  provider: "binance"
""")
        config_path = f.name
    
    try:
        config = Config.from_path(config_path)
        assert config.get("trading.symbols") == ["BTCUSDT", "ETHUSDT"]
        assert config.get("data.provider") == "binance"
    finally:
        os.unlink(config_path)


def test_config_default_values():
    """Test default value handling."""
    config = Config({})
    
    assert config.get("nonexistent.key", "default") == "default"
    assert config.get("trading.symbols", []) == []


def test_api_key_methods():
    """Test API key retrieval methods."""
    config = Config({})
    
    # These will return None unless environment variables are set
    api_key = config.get_api_key("binance")
    api_secret = config.get_api_secret("binance")
    
    # Should not raise exceptions
    assert api_key is None or isinstance(api_key, str)
    assert api_secret is None or isinstance(api_secret, str)