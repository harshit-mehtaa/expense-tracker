import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useNavigate } from 'react-router-dom';
import { IndianRupee, TrendingUp, Shield, BarChart3 } from 'lucide-react';
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
    formState: { errors, isSubmitting },
  } = useForm<LoginFormData>({ resolver: zodResolver(loginSchema) });

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
              <Label htmlFor="email" className="text-sm font-medium">Email</Label>
              <Input
                id="email"
                type="email"
                placeholder="admin@family.local"
                autoComplete="email"
                {...register('email')}
              />
              {errors.email && (
                <p className="text-xs text-destructive">{errors.email.message}</p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="password" className="text-sm font-medium">Password</Label>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                {...register('password')}
              />
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
          </form>

          <p className="mt-6 text-center text-xs text-muted-foreground">
            Contact your admin to get access.
          </p>
        </div>
      </div>
    </div>
  );
}
