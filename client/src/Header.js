import { Link } from "react-router-dom";
import { useContext, useEffect } from "react";
import { UserContext } from "./UserContext";

export default function Header() {
  const { setUserInfo, userInfo } = useContext(UserContext);
  useEffect(() => {
    fetch('https://test-kappa-ten-90.vercel.app/profile', {
      credentials: 'include',
    })
      .then(response => {
        if (!response.ok) {
          throw new Error(`HTTP error! Status: ${response.status}`);
        }
        return response.json();
      })
      .then(userInfo => {
        setUserInfo(userInfo);
      })
      .catch(error => {
        console.error('Error fetching profile:', error);
      });
  }, []);
  

  function logout() {
    fetch('http://localhost:4000/logout', {
      credentials: 'include',
      method: 'POST',
    });
    setUserInfo(null);
  }

  const username = userInfo?.username;

  return (
    <header>
      <Link to="/" className="logo">MyBlog</Link>
      <nav>
        {username && (
          <>
            <Link to="/create" className="button">Create new post</Link>
            <a onClick={logout} className="button" >Logout ({username})</a>
          </>
        )}
        {!username && (
          <>
          
            <Link role="button" className="button" to="/login">Login</Link>
            <Link className="button" to="/register">Register</Link>
          </>
        )}
      </nav>
    </header>
  );
}
