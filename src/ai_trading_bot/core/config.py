"""Configuration management for the AI Trading Bot."""

import os
from pathlib import Path
from typing import Dict, Any, Optional
import yaml
from dotenv import load_dotenv


class Config:
    """Configuration class for the trading bot."""
    
    def __init__(self, config_dict: Dict[str, Any]):
        """Initialize configuration from dictionary."""
        self.config = config_dict
        
        # Load environment variables
        load_dotenv()
    
    @classmethod
    def from_path(cls, config_path: str) -> "Config":
        """Load configuration from YAML file."""
        config_file = Path(config_path)
        
        if not config_file.exists():
            # Create default config if it doesn't exist
            cls._create_default_config(config_file)
        
        with open(config_file, "r") as f:
            config_dict = yaml.safe_load(f)
        
        return cls(config_dict)
    
    @staticmethod
    def _create_default_config(config_path: Path):
        """Create a default configuration file."""
        config_path.parent.mkdir(parents=True, exist_ok=True)
        
        default_config = {
            "trading": {
                "symbols": ["BTCUSDT", "ETHUSDT", "ADAUSDT"],
                "base_currency": "USDT",
                "initial_balance": 10000,
                "max_position_size": 0.1,
                "stop_loss_percentage": 0.02,
                "take_profit_percentage": 0.05
            },
            "data": {
                "provider": "binance",
                "timeframe": "1h",
                "lookback_periods": 100
            },
            "ai": {
                "model_type": "lstm",
                "features": ["close", "volume", "rsi", "macd"],
                "prediction_horizon": 24,
                "retrain_interval": 168  # hours
            },
            "risk_management": {
                "max_drawdown": 0.1,
                "position_sizing": "kelly",
                "diversification": True
            },
            "logging": {
                "level": "INFO",
                "file": "logs/trading_bot.log"
            }
        }
        
        with open(config_path, "w") as f:
            yaml.dump(default_config, f, default_flow_style=False, indent=2)
    
    def get(self, key: str, default: Any = None) -> Any:
        """Get configuration value by dot notation key."""
        keys = key.split(".")
        value = self.config
        
        for k in keys:
            if isinstance(value, dict) and k in value:
                value = value[k]
            else:
                return default
        
        return value
    
    def get_api_key(self, service: str) -> Optional[str]:
        """Get API key from environment variables."""
        env_var = f"{service.upper()}_API_KEY"
        return os.getenv(env_var)
    
    def get_api_secret(self, service: str) -> Optional[str]:
        """Get API secret from environment variables."""
        env_var = f"{service.upper()}_API_SECRET"
        return os.getenv(env_var)