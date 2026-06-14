import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Mail, Lock, Eye, EyeOff, User as UserIcon } from "lucide-react";
import { FcGoogle } from "react-icons/fc";
import { apiService } from "@/services";
import { useToast } from "@/hooks/use-toast";
import { User } from "@/types";
import { useAuth } from "@/contexts/AuthContext";

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAuthSuccess?: (user: User, token: string) => void;
}

const AuthModal = ({ isOpen, onClose, onAuthSuccess }: AuthModalProps) => {
  const { login } = useAuth();
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [activeTab, setActiveTab] = useState("login");
  
  // Form states
  const [loginForm, setLoginForm] = useState({
    email: "",
    password: "",
  });
  
  const [signupForm, setSignupForm] = useState({
    fullname: "",
    email: "",
    password: "",
  });
  
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [passwordStrength, setPasswordStrength] = useState<'weak' | 'medium' | 'strong' | null>(null);
  const [acceptTerms, setAcceptTerms] = useState(false);
  const { toast } = useToast();

  // Reset form when modal opens
  useEffect(() => {
    if (isOpen) {
      // Reset all form states
      setLoginForm({ email: "", password: "" });
      setSignupForm({ fullname: "", email: "", password: "" });
      setErrors({});
      setPasswordStrength(null);
      setAcceptTerms(false);
      setShowPassword(false);
      setShowConfirmPassword(false);
      setActiveTab("login");
    }
  }, [isOpen]);

  // Password strength checker
  const checkPasswordStrength = (password: string) => {
    if (!password) return null;
    
    let score = 0;
    const criteria = {
      length: password.length >= 8,
      lowercase: /[a-z]/.test(password),
      uppercase: /[A-Z]/.test(password),
      number: /[0-9]/.test(password),
      special: /[^A-Za-z0-9]/.test(password)
    };
    
    if (criteria.length) score++;
    if (criteria.lowercase) score++;
    if (criteria.uppercase) score++;
    if (criteria.number) score++;
    if (criteria.special) score++;
    
    if (score <= 2) return 'weak';
    if (score <= 4) return 'medium';
    return 'strong';
  };

  const validateForm = (isSignUp: boolean) => {
    const newErrors: Record<string, string> = {};
    
    if (isSignUp) {
      // Full name validation
      if (!signupForm.fullname.trim()) {
        newErrors.fullname = "Full name is required";
      } else if (signupForm.fullname.trim().length < 2) {
        newErrors.fullname = "Full name must be at least 2 characters";
      }
      
      // Email validation
      if (!signupForm.email.trim()) {
        newErrors.email = "Email is required";
      } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(signupForm.email.trim())) {
        newErrors.email = "Please enter a valid email address";
      }
      
      // Password validation
      if (!signupForm.password) {
        newErrors.password = "Password is required";
      } else if (signupForm.password.length > 128) {
        newErrors.password = "Password must be less than 128 characters";
      }
      

      
      // Terms and conditions validation
      if (!acceptTerms) {
        newErrors.terms = "You must accept the Terms of Service and Privacy Policy";
      }
      
    } else {
      // Login validation
      if (!loginForm.email.trim()) {
        newErrors.email = "Email is required";
      } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(loginForm.email.trim())) {
        newErrors.email = "Please enter a valid email address";
      }
      
      if (!loginForm.password) {
        newErrors.password = "Password is required";
      }
    }
    
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleGoogleAuth = () => {
    setIsLoading(true);
    // Add your Google SSO logic here
    setTimeout(() => setIsLoading(false), 2000);
  };

  const handleEmailAuth = async (isSignUp: boolean) => {
    if (!validateForm(isSignUp)) return;
    
    setIsLoading(true);
    setErrors({});
    
    try {
      if (isSignUp) {
        const response = await apiService.register({
          email: signupForm.email,
          password: signupForm.password,
          fullname: signupForm.fullname,
        });
        
        toast({
          title: "Account Created Successfully",
          description: response.message,
          className: "bg-gradient-to-r from-academic-teal/10 to-academic-burgundy/10 border-2 border-academic-teal/30 text-academic-teal shadow-lg",
        });
        
        // Auto-login after successful registration
        const loginResponse = await apiService.login({
          email: signupForm.email,
          password: signupForm.password,
        });
        
        login(loginResponse.user, loginResponse.access_token);
        onAuthSuccess?.(loginResponse.user, loginResponse.access_token);
        onClose();
        
      } else {
        const response = await apiService.login({
          email: loginForm.email,
          password: loginForm.password,
        });
        
        toast({
          title: "Login Successful",
          description: response.message,
          className: "bg-gradient-to-r from-academic-teal/10 to-academic-burgundy/10 border-2 border-academic-teal/30 text-academic-teal shadow-lg",
        });
        
        login(response.user, response.access_token);
        onAuthSuccess?.(response.user, response.access_token);
        onClose();
      }
    } catch (error: unknown) {
      console.error('Authentication error:', error);
      
      let errorMessage = "Authentication failed. Please try again.";
      if (error instanceof Error && error.message && error.message.includes("API request failed:")) {
        try {
          const errorData = JSON.parse(error.message.replace("API request failed: ", ""));
          errorMessage = errorData.detail || errorData.message || errorMessage;
        } catch {
          errorMessage = error.message;
        }
      }
      
      toast({
        title: "Authentication Failed",
        description: errorMessage,
        className: "bg-gradient-to-r from-academic-burgundy/10 to-academic-rose/10 border-2 border-academic-burgundy/30 text-academic-burgundy shadow-lg",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleInputChange = (formType: 'login' | 'signup', field: string, value: string) => {
    if (formType === 'login') {
      setLoginForm(prev => ({ ...prev, [field]: value }));
    } else {
      setSignupForm(prev => ({ ...prev, [field]: value }));
    }
    
    // Clear error when user starts typing
    if (errors[field]) {
      setErrors(prev => ({ ...prev, [field]: "" }));
    }
    
    // Check password strength for signup password field
    if (formType === 'signup' && field === 'password') {
      setPasswordStrength(checkPasswordStrength(value));
    }
  };

  const handleTabChange = (value: string) => {
    setActiveTab(value);
    setErrors({});
    setLoginForm({ email: "", password: "" });
    setSignupForm({ fullname: "", email: "", password: "" });
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md w-[95vw] sm:w-full max-h-[90vh] sm:max-h-none p-0 gap-0 overflow-hidden rounded-2xl shadow-2xl border-0 bg-gradient-to-br from-background via-background to-academic-light-rose/5 backdrop-blur-sm">
        <div className="bg-gradient-to-br from-academic-teal/5 via-background to-academic-burgundy/5 p-4 sm:p-6 md:p-8 rounded-2xl">
          <DialogHeader className="text-center mb-4 sm:mb-6">
            <DialogTitle className="text-xl sm:text-2xl font-bold bg-gradient-to-r from-academic-teal to-academic-burgundy bg-clip-text text-transparent">
              Welcome to StudyAssistant
            </DialogTitle>
            <p className="text-sm sm:text-base text-muted-foreground mt-2">
              Join thousands of students enhancing their learning journey
            </p>
          </DialogHeader>

          <Tabs value={activeTab} onValueChange={handleTabChange} className="w-full">
            <TabsList className="grid w-full grid-cols-2 gap-2 mb-4 sm:mb-6 bg-gradient-to-r from-academic-teal/10 via-academic-burgundy/10 to-academic-rose/10 rounded-xl p-2 shadow-lg border border-border/20">
              <TabsTrigger value="login" className="text-xs sm:text-sm font-medium py-3 sm:py-4 rounded-lg transition-all duration-300 data-[state=active]:shadow-lg data-[state=active]:bg-gradient-to-r data-[state=active]:from-academic-teal data-[state=active]:to-academic-burgundy data-[state=active]:text-white data-[state=active]:scale-[1.02] hover:bg-muted/50">
                Sign In
              </TabsTrigger>
              <TabsTrigger value="signup" className="text-xs sm:text-sm font-medium py-3 sm:py-4 rounded-lg transition-all duration-300 data-[state=active]:shadow-lg data-[state=active]:bg-gradient-to-r data-[state=active]:from-academic-teal data-[state=active]:to-academic-burgundy data-[state=active]:text-white data-[state=active]:scale-[1.02] hover:bg-muted/50">
                Sign Up
              </TabsTrigger>
            </TabsList>

            <TabsContent value="login" className="space-y-3 sm:space-y-4 mt-0">
              <div className="space-y-3 sm:space-y-4">
                <Button
                  onClick={handleGoogleAuth}
                  disabled={isLoading}
                  variant="outline"
                  className="w-full h-11 sm:h-12 border-2 border-border/30 hover:border-border/50 hover:bg-muted/30 transition-all duration-300 text-sm rounded-xl shadow-sm hover:shadow-md"
                >
                  <FcGoogle className="w-4 h-4 sm:w-5 sm:h-5 mr-2 sm:mr-3" />
                  Continue with Google
                </Button>

                <div className="relative">
                  <div className="absolute inset-0 flex items-center">
                    <Separator className="w-full" />
                  </div>
                  <div className="relative flex justify-center text-xs uppercase">
                    <span className="bg-background px-2 text-muted-foreground">
                      Or continue with email
                    </span>
                  </div>
                </div>

                <div className="space-y-3 sm:space-y-4">
                  <div className="space-y-1.5 sm:space-y-2">
                    <Label htmlFor="login-email" className="text-sm">Email</Label>
                    <div className="relative">
                      <Mail className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground w-4 h-4" />
                      <Input
                        id="login-email"
                        type="email"
                        placeholder="Enter your email"
                        className={`pl-10 h-11 sm:h-12 text-sm rounded-xl border-2 border-border/30 focus:border-academic-teal/50 focus:ring-2 focus:ring-academic-teal/20 transition-all duration-300 shadow-sm hover:shadow-md ${errors.email ? 'border-academic-burgundy ring-2 ring-academic-burgundy/20' : ''}`}
                        value={loginForm.email}
                        onChange={(e) => handleInputChange('login', 'email', e.target.value)}
                      />
                    </div>
                    {errors.email && <p className="text-xs text-academic-burgundy">{errors.email}</p>}
                  </div>

                  <div className="space-y-1.5 sm:space-y-2">
                    <Label htmlFor="login-password" className="text-sm">Password</Label>
                    <div className="relative">
                      <Lock className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground w-4 h-4" />
                      <Input
                        id="login-password"
                        type={showPassword ? "text" : "password"}
                        placeholder="Enter your password"
                        className={`pl-10 pr-10 h-11 sm:h-12 text-sm rounded-xl border-2 border-border/30 focus:border-academic-teal/50 focus:ring-2 focus:ring-academic-teal/20 transition-all duration-300 shadow-sm hover:shadow-md ${errors.password ? 'border-academic-burgundy ring-2 ring-academic-burgundy/20' : ''}`}
                        value={loginForm.password}
                        onChange={(e) => handleInputChange('login', 'password', e.target.value)}
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        className="absolute right-3 top-1/2 transform -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      >
                        {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                    {errors.password && <p className="text-xs text-academic-burgundy">{errors.password}</p>}
                  </div>

                  <div className="flex items-center justify-between text-xs sm:text-sm">
                    <label className="flex items-center space-x-2">
                      <input type="checkbox" className="rounded border-border" />
                      <span className="text-muted-foreground">Remember me</span>
                    </label>
                    <button className="text-academic-teal hover:text-academic-teal/80 font-medium">
                      Forgot password?
                    </button>
                  </div>

                  <Button
                    onClick={() => handleEmailAuth(false)}
                    disabled={isLoading}
                    className="w-full h-11 sm:h-12 bg-gradient-to-r from-academic-teal to-academic-burgundy hover:from-academic-teal/90 hover:to-academic-burgundy/90 text-white font-medium text-sm rounded-xl shadow-lg hover:shadow-xl transition-all duration-300 transform hover:scale-[1.02]"
                  >
                    {isLoading ? "Signing in..." : "Sign In"}
                  </Button>
                </div>
              </div>
            </TabsContent>

            <TabsContent value="signup" className="space-y-2 sm:space-y-4 mt-0">
              <div className="space-y-2 sm:space-y-4">
                <Button
                  onClick={handleGoogleAuth}
                  disabled={isLoading}
                  variant="outline"
                  className="w-full h-11 sm:h-12 border-2 border-border/30 hover:border-border/50 hover:bg-muted/30 transition-all duration-300 text-sm rounded-xl shadow-sm hover:shadow-md"
                >
                  <FcGoogle className="w-4 h-4 sm:w-5 sm:h-5 mr-2 sm:mr-3" />
                  Continue with Google
                </Button>

                <div className="relative">
                  <div className="absolute inset-0 flex items-center">
                    <Separator className="w-full" />
                  </div>
                  <div className="relative flex justify-center text-xs uppercase">
                    <span className="bg-background px-2 text-muted-foreground">
                      Or create account with email
                    </span>
                  </div>
                </div>

                <div className="space-y-2 sm:space-y-4">
                  <div className="space-y-1 sm:space-y-2">
                    <Label htmlFor="fullname" className="text-sm">Full Name</Label>
                    <div className="relative">
                      <UserIcon className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground w-4 h-4" />
                                              <Input
                          id="fullname"
                          placeholder="John Doe"
                          className={`pl-10 h-10 sm:h-12 text-sm rounded-xl border-2 border-border/30 focus:border-academic-teal/50 focus:ring-2 focus:ring-academic-teal/20 transition-all duration-300 shadow-sm hover:shadow-md ${errors.fullname ? 'border-academic-burgundy ring-2 ring-academic-burgundy/20' : ''}`}
                          value={signupForm.fullname}
                          onChange={(e) => handleInputChange('signup', 'fullname', e.target.value)}
                        />
                    </div>
                    {errors.fullname && <p className="text-xs text-academic-burgundy">{errors.fullname}</p>}
                  </div>

                  <div className="space-y-1 sm:space-y-2">
                    <Label htmlFor="signup-email" className="text-sm">Email</Label>
                    <div className="relative">
                      <Mail className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground w-4 h-4" />
                      <Input
                        id="signup-email"
                        type="email"
                        placeholder="Enter your email"
                        className={`pl-10 h-10 sm:h-12 text-sm rounded-xl border-2 border-border/30 focus:border-academic-teal/50 focus:ring-2 focus:ring-academic-teal/20 transition-all duration-300 shadow-sm hover:shadow-md ${errors.email ? 'border-academic-burgundy ring-2 ring-academic-burgundy/20' : ''}`}
                        value={signupForm.email}
                        onChange={(e) => handleInputChange('signup', 'email', e.target.value)}
                      />
                    </div>
                    {errors.email && <p className="text-xs text-academic-burgundy">{errors.email}</p>}
                  </div>

                  <div className="space-y-1 sm:space-y-2">
                    <Label htmlFor="signup-password" className="text-sm">Password</Label>
                    <div className="relative">
                      <Lock className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground w-4 h-4" />
                      <Input
                        id="signup-password"
                        type={showPassword ? "text" : "password"}
                        placeholder="Create a password"
                        className={`pl-10 pr-10 h-10 sm:h-12 text-sm rounded-xl border-2 border-border/30 focus:border-academic-teal/50 focus:ring-2 focus:ring-academic-teal/20 transition-all duration-300 shadow-sm hover:shadow-md ${errors.password ? 'border-academic-burgundy ring-2 ring-academic-burgundy/20' : ''}`}
                        value={signupForm.password}
                        onChange={(e) => handleInputChange('signup', 'password', e.target.value)}
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        className="absolute right-3 top-1/2 transform -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      >
                        {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                    {errors.password && <p className="text-xs text-academic-burgundy">{errors.password}</p>}
                    
                    {/* Password Strength Indicator */}
                    {signupForm.password && !errors.password && (
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <div className="flex gap-1">
                            <div className={`h-1 w-8 rounded-full transition-colors ${
                              passwordStrength === 'weak' ? 'bg-red-500' : 
                              passwordStrength === 'medium' ? 'bg-yellow-500' : 
                              passwordStrength === 'strong' ? 'bg-green-500' : 'bg-gray-300'
                            }`} />
                            <div className={`h-1 w-8 rounded-full transition-colors ${
                              passwordStrength === 'medium' ? 'bg-yellow-500' : 
                              passwordStrength === 'strong' ? 'bg-green-500' : 'bg-gray-300'
                            }`} />
                            <div className={`h-1 w-8 rounded-full transition-colors ${
                              passwordStrength === 'strong' ? 'bg-green-500' : 'bg-gray-300'
                            }`} />
                          </div>
                          <span className={`text-xs font-medium ${
                            passwordStrength === 'weak' ? 'text-red-600' : 
                            passwordStrength === 'medium' ? 'text-yellow-600' : 
                            passwordStrength === 'strong' ? 'text-green-600' : 'text-muted-foreground'
                          }`}>
                            {passwordStrength === 'weak' ? 'Weak' : 
                             passwordStrength === 'medium' ? 'Medium' : 
                             passwordStrength === 'strong' ? 'Strong' : ''}
                          </span>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          Strong password: 8+ chars, lowercase, uppercase, number, special character
                        </p>
                      </div>
                    )}
                  </div>



                  <div className="space-y-2 sm:space-y-4">
                    <label className="flex items-start space-x-2 text-xs sm:text-sm">
                      <input 
                        type="checkbox" 
                        className="rounded border-border mt-0.5 flex-shrink-0" 
                        checked={acceptTerms}
                        onChange={(e) => setAcceptTerms(e.target.checked)}
                      />
                      <span className="text-muted-foreground leading-relaxed">
                        I agree to the{" "}
                        <button className="text-academic-teal hover:text-academic-teal/80 font-medium">
                          Terms of Service
                        </button>{" "}
                        and{" "}
                        <button className="text-academic-teal hover:text-academic-teal/80 font-medium">
                          Privacy Policy
                        </button>
                      </span>
                    </label>
                    {errors.terms && <p className="text-xs text-academic-burgundy">{errors.terms}</p>}

                    <Button
                      onClick={() => handleEmailAuth(true)}
                      disabled={isLoading}
                      className="w-full h-10 sm:h-12 bg-gradient-to-r from-academic-teal to-academic-burgundy hover:from-academic-teal/90 hover:to-academic-burgundy/90 text-white font-medium text-sm rounded-xl shadow-lg hover:shadow-xl transition-all duration-300 transform hover:scale-[1.02]"
                    >
                      {isLoading ? "Creating account..." : "Create Account"}
                    </Button>
                  </div>
                </div>
              </div>
            </TabsContent>
          </Tabs>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default AuthModal;