import { Link } from 'react-router-dom';
import { Home, Compass } from 'lucide-react';

export default function NotFound() {
  return (
    <div className="max-w-md mx-auto text-center py-16 vb-rise">
      <p className="font-display font-bold text-7xl text-accent/25">404</p>
      <h1 className="font-display font-bold text-xl mt-2">Page not found</h1>
      <p className="text-sm text-ink3 mt-2">The page you're looking for doesn't exist or was moved.</p>
      <div className="flex gap-2 justify-center mt-6">
        <Link to="/" className="btn btn-primary"><Home size={15} /> Back to feed</Link>
        <Link to="/board" className="btn btn-ghost"><Compass size={15} /> Solving board</Link>
      </div>
    </div>
  );
}
