"""
AI Trading Bot - An intelligent trading system using machine learning.
"""

__version__ = "0.1.0"
__author__ = "Vitaliy Vorynka"
__email__ = "your.email@example.com"

from .core.bot import TradingBot
from .core.config import Config

__all__ = ["TradingBot", "Config"]