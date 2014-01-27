/*
helpers for handling redis-server processes.
going semi-colon free.
*/

var async = require('async'),
    child_process = require('child_process'),
    fs = require('fs'),
    redisVersion = process.env.REDIS_VERSION;

/*
@param patterns: array of, or single, regex pattern(s) or string(s). (has to match all)
*/
function killProc(patterns, callback){

  child_process.exec('ps -e -o pid,command', function(error, stdout, stderr){
    if (error) return callback(error)
    else if (stderr.trim() !== '') return callback(new Error(stderr.trim()))

    var procList = stdout.split("\n"),
        l, procLine, proc, pattern,
        procs = [],
        matches = false

    // first line is headers
    procList.shift()

    for (l in procList) {
      procLine = procList[l],
      procParts = procLine.match(/^\s*([0-9]*)\s(.*)$/) || []

      proc = {
        pid: procParts[1] || null,
        cmd: procParts[2] || null
      }

      if (proc.pid && proc.pid.trim() !== '' && proc.cmd && proc.cmd.trim() !== '') {
        // allow for no pattern, then returns all.
        // presume match unless it fails a pattern.
        matches = true

        if (! Array.isArray(patterns)) patterns = [ patterns ]

        for (l in patterns) {
          pattern = patterns[l]

          // - as a string
          if (typeof pattern === 'string') {
            if (proc.cmd.indexOf(pattern) < 0) {
              matches = false
            }
          }

          // - as a regex pattern
          else if (pattern != null && !proc.cmd.match(pattern)) {
            matches = false
          }
        }

        if (matches) procs.push(proc.pid)
      }
    }

    if(procs[0]){
      var killString = 'kill ' + procs.join(' ');
      console.log('killing process ' + killString);
      child_process.exec(killString, callback);
    } else {
      callback();
    }
  })
}

function killOldRedises(callback){
  async.series([
  function(ok){
    killProc(['redis-server', '5379'], ok)
  },
  function(ok){
    killProc(['redis-server', '5380'], ok)
  },
  function(ok){
    killProc(['redis-server', '5381'], ok)
  },
  function(ok){
    killProc(['redis-sentinel', '8379'], ok)
  },
  function(ok){
    killProc(['redis-sentinel', '8380'], ok)
  },
  function(ok){
    killProc(['redis-sentinel', '8381'], ok)
  }
], function(error, pids){
    if (error) throw new Error(error);

    setTimeout(startCluster, 1000, callback);
  });
}

function startCluster(callback){

  console.log('Starting Redises');

  var redisServer = './tmp/redis-' + redisVersion + '/src/redis-server';
  var redisSentinel = './tmp/redis-' + redisVersion + '/src/redis-sentinel';

  var master = child_process.spawn(redisServer, ['--port', '5379', '--save', '""']);
  var slave1 = child_process.spawn(redisServer, ['--port', '5380', '--save', '""', '--slaveof', 'localhost', '5379']);
  var slave2 = child_process.spawn(redisServer, ['--port', '5381', '--save', '""', '--slaveof', 'localhost', '5379']);

  var sentinel1Conf = fs.openSync('./tmp/sentinel1.conf', 'w');
  var sentinel2Conf = fs.openSync('./tmp/sentinel2.conf', 'w');
  var sentinel3Conf = fs.openSync('./tmp/sentinel3.conf', 'w');
  fs.writeSync(sentinel1Conf,
                 'port 8379\n' +
                 'sentinel monitor mymaster 127.0.0.1 5379 1\n' +
                 'sentinel down-after-milliseconds mymaster 5000\n' +
                 'sentinel failover-timeout mymaster 6000\n' +
                 'sentinel parallel-syncs mymaster 1\n');
  fs.writeSync(sentinel2Conf,
                 'port 8380\n' +
                 'sentinel monitor mymaster 127.0.0.1 5379 1\n' +
                 'sentinel down-after-milliseconds mymaster 5000\n' +
                 'sentinel failover-timeout mymaster 6000\n' +
                 'sentinel parallel-syncs mymaster 1\n');
   fs.writeSync(sentinel3Conf,
                 'port 8381\n' +
                 'sentinel monitor mymaster 127.0.0.1 5379 1\n' +
                 'sentinel down-after-milliseconds mymaster 5000\n' +
                 'sentinel failover-timeout mymaster 6000\n' +
                 'sentinel parallel-syncs mymaster 1\n');

  fs.closeSync(sentinel1Conf);
  fs.closeSync(sentinel2Conf);
  fs.closeSync(sentinel3Conf);

  var sentinel1 = child_process.spawn(redisSentinel, ['./tmp/sentinel1.conf']);
  var sentinel2 = child_process.spawn(redisSentinel, ['./tmp/sentinel2.conf']);
  var sentinel3 = child_process.spawn(redisSentinel, ['./tmp/sentinel3.conf']);

  process.on('exit', function () {
    master.kill();
    slave1.kill();
    slave2.kill();
    sentinel1.kill();
    sentinel2.kill();
    sentinel3.kill();
  });

  //wait for cluster to get into a good state before continuing
  setTimeout(callback, 10000, null,
              {
                "master": master,
                "slave1": slave1,
                "slave2": slave2,
                "sentinel1": sentinel1,
                "sentinel2": sentinel2,
                "sentinel3": sentinel3
              }
            );
}

module.exports.startCluster = function(callback){
  killOldRedises(callback);
}
