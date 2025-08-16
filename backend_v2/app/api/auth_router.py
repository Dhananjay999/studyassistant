from fastapi import APIRouter, HTTPException, status, Depends, Header
from typing import List, Optional
from ..models.schemas import UserCreate, UserLogin, UserResponse, LoginResponse, TokenData
from ..services.auth_service import AuthService
from ..utils.jwt_utils import JWTManager

router = APIRouter(prefix="/auth", tags=["Authentication"])

# Initialize service
auth_service = AuthService()

@router.post("/register", response_model=LoginResponse)
async def create_user(user: UserCreate):
    """Create a new user with JWT token"""
    try:
        return auth_service.create_user(user)
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e)
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(e)
        )

@router.post("/login", response_model=LoginResponse)
async def login_user(user: UserLogin):
    """Login user"""
    try:
        return auth_service.login_user(user)
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=str(e)
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(e)
        )

@router.get("/users", response_model=List[UserResponse])
async def get_all_users():
    """Get all users with full details"""
    try:
        return auth_service.get_all_users()
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(e)
        )

@router.get("/verify", response_model=TokenData)
async def verify_token(authorization: Optional[str] = Header(None)):
    """Verify JWT token"""
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid authorization header"
        )
    
    token = authorization.replace("Bearer ", "")
    token_data = JWTManager.verify_token(token)
    
    if not token_data:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token"
        )
    
    return token_data 