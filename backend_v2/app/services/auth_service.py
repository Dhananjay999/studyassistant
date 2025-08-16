from typing import List, Optional
from ..models.schemas import UserCreate, UserLogin, UserResponse, LoginResponse
from ..config.database import db_manager
from ..utils.jwt_utils import JWTManager
import logging

logger = logging.getLogger(__name__)

class AuthService:
    """Authentication service for user management"""
    
    def create_user(self, user: UserCreate) -> LoginResponse:
        """Create a new user with JWT token"""
        try:
            with db_manager.get_cursor() as cursor:
                # Check if user already exists
                cursor.execute("SELECT id FROM users WHERE email = %s", (user.email,))
                if cursor.fetchone():
                    raise ValueError("User with this email already exists")
                
                # Insert new user
                cursor.execute(
                    "INSERT INTO users (email, password, fullname) VALUES (%s, %s, %s) RETURNING id, email, fullname",
                    (user.email, user.password, user.fullname)
                )
                new_user = cursor.fetchone()
                
                # Generate JWT token
                access_token = JWTManager.create_user_token(
                    user_id=new_user['id'],
                    email=new_user['email']
                )
                
                logger.info(f"User created successfully: {user.email}")
                return LoginResponse(
                    user=UserResponse(**new_user),
                    access_token=access_token,
                    token_type="bearer",
                    message="User created successfully"
                )
                
        except ValueError as e:
            logger.warning(f"User creation failed - validation error: {e}")
            raise
        except Exception as e:
            logger.error(f"User creation failed: {e}")
            raise Exception(f"Error creating user: {str(e)}")
    
    def login_user(self, user: UserLogin) -> LoginResponse:
        """Authenticate user login"""
        try:
            with db_manager.get_cursor() as cursor:
                # Check if user exists and password matches
                cursor.execute(
                    "SELECT id, email, fullname FROM users WHERE email = %s AND password = %s",
                    (user.email, user.password)
                )
                user_data = cursor.fetchone()
                
                if not user_data:
                    logger.warning(f"Login failed for email: {user.email}")
                    raise ValueError("Invalid email or password")
                
                # Generate JWT token
                access_token = JWTManager.create_user_token(
                    user_id=user_data['id'],
                    email=user_data['email']
                )
                
                logger.info(f"User logged in successfully: {user.email}")
                return LoginResponse(
                    user=UserResponse(**user_data),
                    access_token=access_token,
                    token_type="bearer",
                    message="Login successful"
                )
                
        except ValueError as e:
            logger.warning(f"Login failed - validation error: {e}")
            raise
        except Exception as e:
            logger.error(f"Login failed: {e}")
            raise Exception(f"Error during login: {str(e)}")
    
    def get_all_users(self) -> List[UserResponse]:
        """Get all users with full details"""
        try:
            with db_manager.get_cursor() as cursor:
                cursor.execute("SELECT id, email, fullname FROM users ORDER BY id")
                users = cursor.fetchall()
                
                logger.info(f"Retrieved {len(users)} users")
                return [UserResponse(**user) for user in users]
                
        except Exception as e:
            logger.error(f"Error retrieving users: {e}")
            raise Exception(f"Error retrieving users: {str(e)}")
    
    def get_user_by_id(self, user_id: int) -> Optional[UserResponse]:
        """Get user by ID"""
        try:
            with db_manager.get_cursor() as cursor:
                cursor.execute(
                    "SELECT id, email, fullname FROM users WHERE id = %s",
                    (user_id,)
                )
                user_data = cursor.fetchone()
                
                if user_data:
                    return UserResponse(**user_data)
                return None
                
        except Exception as e:
            logger.error(f"Error retrieving user {user_id}: {e}")
            raise Exception(f"Error retrieving user: {str(e)}")
    
    def get_user_by_email(self, email: str) -> Optional[UserResponse]:
        """Get user by email"""
        try:
            with db_manager.get_cursor() as cursor:
                cursor.execute(
                    "SELECT id, email, fullname FROM users WHERE email = %s",
                    (email,)
                )
                user_data = cursor.fetchone()
                
                if user_data:
                    return UserResponse(**user_data)
                return None
                
        except Exception as e:
            logger.error(f"Error retrieving user by email {email}: {e}")
            raise Exception(f"Error retrieving user: {str(e)}")
    
 