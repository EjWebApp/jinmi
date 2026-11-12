// 카페24 Node.js 호스팅은 web.js 를 시작 파일로, 8001 포트를 사용합니다.
if (!process.env.PORT && process.env.NODE_ENV === 'production') process.env.PORT = '8001';
require('./server');
