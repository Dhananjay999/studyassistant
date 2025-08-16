from datetime import datetime, timedelta
from typing import Optional
from jose import JWTError, jwt
from ..config.settings import settings
from ..models.schemas import TokenData
import logging

logger = logging.getLogger(__name__)

class JWTManager:
    """JWT token management utilities"""
    
    @staticmethod
    def create_access_token(data: dict, expires_delta: Optional[timedelta] = None) -> str:
        """Create JWT access token"""
        to_encode = data.copy()
        
        if expires_delta:
            expire = datetime.utcnow() + expires_delta
        else:
            expire = datetime.utcnow() + timedelta(minutes=settings.JWT_ACCESS_TOKEN_EXPIRE_MINUTES)
        
        to_encode.update({"exp": expire})
        
        try:
            encoded_jwt = jwt.encode(
                to_encode, 
                settings.JWT_SECRET_KEY, 
                algorithm=settings.JWT_ALGORITHM
            )
            logger.info(f"JWT token created for user_id: {data.get('user_id')}")
            return encoded_jwt
        except Exception as e:
            logger.error(f"Error creating JWT token: {e}")
            raise Exception("Failed to create access token")
    
    @staticmethod
    def verify_token(token: str) -> Optional[TokenData]:
        """Verify and decode JWT token"""
        try:
            payload = jwt.decode(
                token, 
                settings.JWT_SECRET_KEY, 
                algorithms=[settings.JWT_ALGORITHM]
            )
            
            user_id: int = payload.get("user_id")
            email: str = payload.get("email")
            
            if user_id is None or email is None:
                logger.warning("Invalid token payload")
                return None
            
            logger.info(f"Token verified for user_id: {user_id}")
            return TokenData(user_id=user_id, email=email)
            
        except JWTError as e:
            logger.warning(f"JWT token verification failed: {e}")
            return None
        except Exception as e:
            logger.error(f"Error verifying JWT token: {e}")
            return None
    
    @staticmethod
    def create_user_token(user_id: int, email: str) -> str:
        """Create JWT token for user"""
        data = {
            "user_id": user_id,
            "email": email,
            "sub": str(user_id)  # Standard JWT subject claim
        }
        return JWTManager.create_access_token(data) 