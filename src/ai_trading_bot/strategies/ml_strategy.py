"""Machine learning-based trading strategy."""

from typing import Dict, Any, Optional
import pandas as pd
from loguru import logger

from .base_strategy import BaseStrategy
from ..core.config import Config


class MLStrategy(BaseStrategy):
    """Trading strategy based on machine learning predictions."""
    
    def __init__(self, config: Config):
        """
        Initialize the ML strategy.
        
        Args:
            config: Configuration object
        """
        super().__init__(config)
        
        self.buy_threshold = config.get("strategy.buy_threshold", 0.02)  # 2% predicted increase
        self.sell_threshold = config.get("strategy.sell_threshold", -0.01)  # 1% predicted decrease
        self.min_confidence = config.get("strategy.min_confidence", 0.6)
        self.position_size = config.get("trading.max_position_size", 0.1)
        
        logger.info(f"ML Strategy initialized with buy_threshold={self.buy_threshold}, "
                   f"sell_threshold={self.sell_threshold}, min_confidence={self.min_confidence}")
    
    def generate_signal(
        self, 
        data: pd.DataFrame, 
        prediction: Optional[Dict[str, Any]] = None
    ) -> Optional[Dict[str, Any]]:
        """
        Generate trading signal based on ML prediction.
        
        Args:
            data: Historical market data
            prediction: ML prediction results
            
        Returns:
            Trading signal dictionary or None
        """
        if prediction is None:
            logger.debug("No prediction available, no signal generated")
            return None
        
        try:
            current_price = data["close"].iloc[-1]
            predicted_price = prediction.get("predicted_price")
            price_change_pct = prediction.get("price_change_pct", 0)
            confidence = prediction.get("confidence", 0)
            
            # Check if confidence is above minimum threshold
            if confidence < self.min_confidence:
                logger.debug(f"Confidence {confidence} below minimum {self.min_confidence}")
                return None
            
            # Generate signal based on predicted price change
            action = "hold"
            quantity = 0
            
            if price_change_pct >= self.buy_threshold:
                action = "buy"
                quantity = self._calculate_position_size(current_price, confidence)
                logger.info(f"Buy signal generated: {price_change_pct:.2f}% predicted increase")
                
            elif price_change_pct <= self.sell_threshold:
                action = "sell"
                quantity = self._calculate_position_size(current_price, confidence)
                logger.info(f"Sell signal generated: {price_change_pct:.2f}% predicted decrease")
            
            if action == "hold":
                logger.debug(f"Hold signal: price change {price_change_pct:.2f}% within thresholds")
                return None
            
            signal = {
                "action": action,
                "quantity": quantity,
                "price": current_price,
                "confidence": confidence,
                "predicted_price": predicted_price,
                "predicted_change_pct": price_change_pct,
                "strategy": self.name,
                "timestamp": data.index[-1]
            }
            
            # Validate signal before returning
            if self.validate_signal(signal):
                return signal
            else:
                logger.warning("Generated signal failed validation")
                return None
                
        except Exception as e:
            logger.error(f"Error generating ML signal: {e}")
            return None
    
    def _calculate_position_size(self, price: float, confidence: float) -> float:
        """
        Calculate position size based on price and confidence.
        
        Args:
            price: Current market price
            confidence: Prediction confidence (0-1)
            
        Returns:
            Position size
        """
        # Base position size from config
        base_size = self.position_size
        
        # Adjust position size based on confidence
        # Higher confidence = larger position (up to 2x base size)
        confidence_multiplier = 1 + confidence
        
        adjusted_size = base_size * confidence_multiplier
        
        # Cap at maximum allowed position size
        max_size = self.config.get("trading.max_position_size", 0.2)
        adjusted_size = min(adjusted_size, max_size)
        
        # Convert to actual quantity (for simplicity, assuming 1 unit = $1)
        # In real implementation, this would consider available balance
        quantity = adjusted_size * 1000  # Assuming $1000 base amount
        
        return max(quantity, 1)  # Minimum 1 unit
    
    def should_rebalance(self, current_positions: Dict[str, float]) -> bool:
        """
        Determine if portfolio should be rebalanced.
        
        Args:
            current_positions: Current portfolio positions
            
        Returns:
            True if rebalancing is needed
        """
        # Simple rebalancing logic - could be enhanced
        total_positions = len(current_positions)
        max_positions = self.config.get("strategy.max_positions", 5)
        
        return total_positions > max_positions
    
    def get_risk_parameters(self) -> Dict[str, float]:
        """
        Get risk management parameters for this strategy.
        
        Returns:
            Dictionary with risk parameters
        """
        return {
            "stop_loss_pct": self.config.get("trading.stop_loss_percentage", 0.02),
            "take_profit_pct": self.config.get("trading.take_profit_percentage", 0.05),
            "max_position_size": self.position_size,
            "min_confidence": self.min_confidence
        }