from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.orm import Session
from app.config.database import get_db
from app.services.auth_service import AuthService
from app.models.auth_schemas import UserCreate, UserLogin, Token, UserResponse

router = APIRouter(prefix="/auth", tags=["authentication"])
security = HTTPBearer()

@router.post("/signup", response_model=Token, status_code=status.HTTP_201_CREATED)
async def signup(user_data: UserCreate, db: Session = Depends(get_db)):
    """
    Register a new user
    """
    # Check if user already exists
    existing_user = AuthService.get_user_by_email(db, user_data.email)
    if existing_user:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Email already registered"
        )
    
    # Create new user
    user = AuthService.create_user(db, user_data)
    
    # Generate access token
    access_token = AuthService.create_access_token(
        data={"sub": user.email}
    )
    
    return Token(
        access_token=access_token,
        token_type="bearer",
        user=UserResponse(
            id=user.id,
            email=user.email,
            full_name=user.full_name,
            field=user.field,
            is_active=user.is_active,
            created_at=user.created_at
        )
    )

@router.post("/login", response_model=Token)
async def login(user_credentials: UserLogin, db: Session = Depends(get_db)):
    """
    Login user with email and password
    """
    # Authenticate user
    user = AuthService.authenticate_user(db, user_credentials.email, user_credentials.password)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password",
            headers={"WWW-Authenticate": "Bearer"},
        )
    
    # Generate access token
    access_token = AuthService.create_access_token(
        data={"sub": user.email}
    )
    
    return Token(
        access_token=access_token,
        token_type="bearer",
        user=UserResponse(
            id=user.id,
            email=user.email,
            full_name=user.full_name,
            field=user.field,
            is_active=user.is_active,
            created_at=user.created_at
        )
    )

 