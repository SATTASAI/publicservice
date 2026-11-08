import {schoolPasskeys} from '../lib/school-passkeys.js';
import {currentUser,json} from '../lib/http.js';
import {verifyPassword,signJWT,buildSessionCookie} from '../lib/crypto.js';
import {createSession} from '../lib/auth-sessions.js';
export const handleSchoolPasskeys=schoolPasskeys({currentUser,verifyPassword,issue:async(request,env,u)=>{
 await env.DB.prepare("UPDATE users SET last_login_at=datetime('now') WHERE id=?").bind(u.id).run();
 const session=await createSession(env,u.id,request,'publicservice');
 const token=await signJWT({sub:u.id,sv:Number(u.session_version||1),sid:session.sid},env.JWT_SECRET);
 return json({ok:true,user:{id:u.id,full_name:u.full_name,role:u.role}},200,{'Set-Cookie':buildSessionCookie(token),'Cache-Control':'no-store'});
}});
