// 每個機器人的第一人稱畫面串流（socket.io），只綁 127.0.0.1。
// 改寫自 prismarine-viewer/lib/mineflayer.js：原版 http.listen(port) 會聽所有網卡，這裡固定綁本機，
// 而且不提供靜態頁面（頁面由辦公室伺服器提供，同源才能把畫面貼到螢幕上）。
const http = require('node:http');
const { Server } = require('socket.io');
const { WorldView } = require('prismarine-viewer/viewer/lib/worldView');

// prismarine-viewer 沒有 1.21 新生物、掉落物等模型，送過去會一直報錯；畫面上只畫其他員工的機器人（玩家）
function onlyPlayers(socket) {
  const players = new Set();
  return {
    on: socket.on.bind(socket),
    emit(event, data) {
      if (event === 'entity') {
        if (data.name !== undefined) {
          if (data.name !== 'player') return true;
          players.add(data.id);
        } else if (!players.has(data.id)) {
          return true;
        }
        if (data.delete) players.delete(data.id);
      }
      return socket.emit(event, data);
    },
  };
}

function startViewer(bot, { port, name, viewDistance = 4, onWatchers, hud }) {
  const server = http.createServer((req, res) => {
    res.writeHead(404);
    res.end();
  });
  const io = new Server(server, { path: `/mc/${name}/socket.io`, serveClient: false });
  const sockets = new Set();

  io.on('connection', (socket) => {
    if (!bot.entity) {
      socket.disconnect();
      return;
    }
    socket.emit('version', bot.version);
    sockets.add(socket);
    onWatchers?.(sockets.size);

    const worldView = new WorldView(bot.world, viewDistance, bot.entity.position, onlyPlayers(socket));
    worldView.init(bot.entity.position);

    // 第一人稱：鏡頭跟著機器人的位置、水平與上下視角
    const botPosition = () => {
      socket.emit('position', { pos: bot.entity.position, yaw: bot.entity.yaw, pitch: bot.entity.pitch, addMesh: false });
      worldView.updatePosition(bot.entity.position);
    };
    botPosition();
    bot.on('move', botPosition);
    worldView.listenToBot(bot);
    // 遊戲介面資料：快捷欄、手持、生命飢餓經驗、揮手與挖掘進度
    const hudTimer = hud ? setInterval(() => socket.emit('hud', hud()), 150) : null;

    socket.on('disconnect', () => {
      clearInterval(hudTimer);
      bot.removeListener('move', botPosition);
      worldView.removeListenersFromBot(bot);
      sockets.delete(socket);
      onWatchers?.(sockets.size);
    });
  });

  server.listen(port, '127.0.0.1');
  return {
    watchers: () => sockets.size,
    close() {
      for (const s of sockets) s.disconnect();
      io.close();
      server.close();
    },
  };
}

module.exports = { startViewer };
