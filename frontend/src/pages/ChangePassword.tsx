import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { z } from 'zod';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import api from '@/lib/api';

const schema = z
  .object({
    currentPassword: z.string().min(1, 'Required'),
    newPassword: z
      .string()
      .min(8, 'Must be at least 8 characters')
      .regex(/[A-Z]/, 'Must contain an uppercase letter')
      .regex(/[0-9]/, 'Must contain a number'),
    confirmPassword: z.string().min(1, 'Required'),
  })
  .refine((d) => d.newPassword === d.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  });

type FormValues = z.infer<typeof schema>;

export default function ChangePasswordPage() {
  const { isAuthenticated, isLoading, logout } = useAuth();
  const navigate = useNavigate();
  const [serverError, setServerError] = useState('');

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(schema) });

  // Redirect unauthenticated visitors to login
  if (!isLoading && !isAuthenticated) {
    navigate('/login', { replace: true });
    return null;
  }

  async function onSubmit(values: FormValues) {
    setServerError('');
    try {
      await api.post('/auth/change-password', {
        oldPassword: values.currentPassword,
        newPassword: values.newPassword,
      });
      // Backend revokes all refresh tokens on success — must re-authenticate
      await logout();
      navigate('/login', { replace: true });
    } catch (err: any) {
      setServerError(err?.response?.data?.message ?? 'Failed to change password');
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="w-full max-w-sm space-y-6">
        <div>
          <h1 className="text-2xl font-bold">Change Password</h1>
          <p className="text-sm text-muted-foreground mt-1">
            You must set a new password before continuing.
          </p>
        </div>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="space-y-1">
            <Label>Current Password</Label>
            <Input {...register('currentPassword')} type="password" autoComplete="current-password" />
            {errors.currentPassword && (
              <p className="text-xs text-destructive">{errors.currentPassword.message}</p>
            )}
          </div>

          <div className="space-y-1">
            <Label>New Password</Label>
            <Input {...register('newPassword')} type="password" autoComplete="new-password" />
            {errors.newPassword && (
              <p className="text-xs text-destructive">{errors.newPassword.message}</p>
            )}
          </div>

          <div className="space-y-1">
            <Label>Confirm New Password</Label>
            <Input {...register('confirmPassword')} type="password" autoComplete="new-password" />
            {errors.confirmPassword && (
              <p className="text-xs text-destructive">{errors.confirmPassword.message}</p>
            )}
          </div>

          {serverError && <p className="text-sm text-destructive">{serverError}</p>}

          <Button type="submit" className="w-full" disabled={isSubmitting}>
            {isSubmitting ? 'Changing…' : 'Change Password'}
          </Button>
        </form>
      </div>
    </div>
  );
}
