"""Base strategy class for trading strategies."""

from abc import ABC, abstractmethod
from typing import Dict, Any, Optional
import pandas as pd

from ..core.config import Config


class BaseStrategy(ABC):
    """Abstract base class for trading strategies."""
    
    def __init__(self, config: Config):
        """
        Initialize the strategy.
        
        Args:
            config: Configuration object
        """
        self.config = config
        self.name = self.__class__.__name__
    
    @abstractmethod
    def generate_signal(
        self, 
        data: pd.DataFrame, 
        prediction: Optional[Dict[str, Any]] = None
    ) -> Optional[Dict[str, Any]]:
        """
        Generate trading signal based on data and prediction.
        
        Args:
            data: Historical market data
            prediction: ML prediction results (optional)
            
        Returns:
            Trading signal dictionary or None
        """
        pass
    
    def validate_signal(self, signal: Dict[str, Any]) -> bool:
        """
        Validate a trading signal.
        
        Args:
            signal: Trading signal to validate
            
        Returns:
            True if signal is valid, False otherwise
        """
        required_fields = ["action", "quantity", "price", "confidence"]
        
        for field in required_fields:
            if field not in signal:
                return False
        
        # Validate action
        if signal["action"] not in ["buy", "sell", "hold"]:
            return False
        
        # Validate quantity and price
        if signal["quantity"] <= 0 or signal["price"] <= 0:
            return False
        
        # Validate confidence
        if not (0 <= signal["confidence"] <= 1):
            return False
        
        return True