import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useNavigate } from 'react-router-dom';
import { BarChart3, Eye, EyeOff, IndianRupee, Shield, TrendingUp } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useState, useEffect } from 'react';

const loginSchema = z.object({
  email: z.string().email('Please enter a valid email'),
  password: z.string().min(1, 'Password is required'),
});

type LoginFormData = z.infer<typeof loginSchema>;

const FEATURES = [
  { icon: TrendingUp, text: 'Track investments, gold & real estate' },
  { icon: BarChart3, text: 'Monthly cashflow & net worth trends' },
  { icon: Shield, text: 'Insurance, loans & tax centre' },
];

export default function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem('theme');
    if (stored) {
      document.documentElement.classList.toggle('dark', stored === 'dark');
      return;
    }
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    document.documentElement.classList.toggle('dark', mq.matches);
    const handler = (e: MediaQueryListEvent) => {
      document.documentElement.classList.toggle('dark', e.matches);
    };
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  const {
    register,
    handleSubmit,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<LoginFormData>({ resolver: zodResolver(loginSchema) });

  const fillDemoAdmin = () => {
    setValue('email', 'harshit@mehta.local', { shouldValidate: true });
    setValue('password', 'Admin@1234', { shouldValidate: true });
    setShowPassword(true);
    setError(null);
  };

  const onSubmit = async (data: LoginFormData) => {
    setError(null);
    try {
      await login(data.email, data.password);
      navigate('/', { replace: true });
    } catch {
      setError('Invalid email or password. Please try again.');
    }
  };

  return (
    <div className="flex min-h-screen">
      {/* Left panel — gradient brand */}
      <div className="hidden lg:flex lg:w-[480px] xl:w-[520px] flex-col justify-between bg-gradient-to-br from-violet-600 via-violet-700 to-indigo-800 p-12 text-white">
        {/* Logo */}
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/20 backdrop-blur-sm">
            <IndianRupee className="h-5 w-5 text-white" />
          </div>
          <span className="text-lg font-semibold tracking-tight">Family Finance</span>
        </div>

        {/* Hero text */}
        <div className="space-y-6">
          <div>
            <h1 className="text-4xl font-bold leading-tight">
              Your family's<br />finances, unified.
            </h1>
            <p className="mt-4 text-lg text-white/70 leading-relaxed">
              One place for every rupee — income, expenses, investments, and goals.
            </p>
          </div>

          <ul className="space-y-4">
            {FEATURES.map(({ icon: Icon, text }) => (
              <li key={text} className="flex items-center gap-3">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/15">
                  <Icon className="h-4 w-4 text-white" />
                </div>
                <span className="text-sm text-white/80">{text}</span>
              </li>
            ))}
          </ul>
        </div>

        {/* Bottom tagline */}
        <p className="text-sm text-white/40">Built for Indian families.</p>
      </div>

      {/* Right panel — form */}
      <div className="flex flex-1 flex-col items-center justify-center bg-background p-8">
        {/* Mobile logo (only on small screens) */}
        <div className="mb-8 flex flex-col items-center gap-2 lg:hidden">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary shadow-violet-md">
            <IndianRupee className="h-6 w-6 text-white" />
          </div>
          <h1 className="text-xl font-bold">Family Finance</h1>
        </div>

        <div className="w-full max-w-sm">
          <div className="mb-8">
            <h2 className="text-2xl font-bold text-foreground">Welcome back</h2>
            <p className="mt-1 text-sm text-muted-foreground">Sign in to your family account</p>
          </div>

          <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
            <div className="space-y-1.5">
              <Label htmlFor="email" className="text-sm font-medium" required>Email</Label>
              <Input
                id="email"
                type="email"
                placeholder="harshit@mehta.local"
                autoComplete="email"
                {...register('email')}
              />
              {errors.email && (
                <p className="text-xs text-destructive">{errors.email.message}</p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="password" className="text-sm font-medium" required>Password</Label>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  className="pr-10"
                  {...register('password')}
                />
                <button
                  type="button"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  className="absolute inset-y-0 right-0 flex w-10 items-center justify-center rounded-r-md text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  onClick={() => setShowPassword((value) => !value)}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              {errors.password && (
                <p className="text-xs text-destructive">{errors.password.message}</p>
              )}
            </div>

            {error && (
              <div className="rounded-lg border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                {error}
              </div>
            )}

            <Button type="submit" className="w-full" size="default" disabled={isSubmitting}>
              {isSubmitting ? 'Signing in...' : 'Sign in'}
            </Button>

            {import.meta.env.DEV && (
              <Button type="button" variant="outline" className="w-full" onClick={fillDemoAdmin} disabled={isSubmitting}>
                Use admin demo
              </Button>
            )}
          </form>

          <p className="mt-6 text-center text-xs text-muted-foreground">
            Contact your admin to get access.
          </p>
        </div>
      </div>
    </div>
  );
}
