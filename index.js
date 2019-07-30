'use strict';

exports.handler = (event, context, callback) => {
    console.log(event);

    const AWS = require("aws-sdk");
    const rds = new AWS.RDS({apiVersion: '2014-10-31'});
    const route53 = new AWS.Route53();
    let DBInstanceIdentifier = event['db-instance-identifier'];
    let timenow = Date.now();
    let strAZ;
    let DBInstanceIdentifierClone = `sl-${event['sl-target-environment']}-${timenow}`;
    let DBSnapshotIdentifier;
    // const EngineVersion = '10.1.34';
    const Engine = 'mariadb';
    let bSnapshotting = true;

    const done = (err, res) => callback(null, {
        statusCode: err ? '400' : '200',
        body: err ? err.message : JSON.stringify(res),
        headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
        },
    });

    let modifyR53 = () => {
        let params = {
            ChangeBatch: {
                Changes: [
                    {
                        Action: "UPSERT",
                        ResourceRecordSet: {
                            Name: `${event['sl-target-environment']}.db.shelterluv.com`,
                            ResourceRecords: [
                                {
                                    Value: `${DBInstanceIdentifierClone}.cmnsmumiuu9e.us-west-2.rds.amazonaws.com`
                                }
                            ],
                            TTL: 60,
                            Type: "CNAME"
                        }
                    }
                ],
            },
            HostedZoneId: "Z1ITFIG5K4LDUZ"
        };
        route53.changeResourceRecordSets(params, function (err, data) {
            if (err) {
                console.log(err, err.stack);
                done(err);
            } else {
                console.log(data);
                done(null, data);
            }
        });
    };

    let restoreSnapshot = () => {
        let params = {
            DBInstanceIdentifier: DBInstanceIdentifierClone,
            Engine: Engine,
            DBSnapshotIdentifier: DBSnapshotIdentifier,
            DBSubnetGroupName: 'shelterluv-review-v1',
            DBInstanceClass: 'db.t3.micro',
            AutoMinorVersionUpgrade: false,
            // EnableCloudwatchLogsExports: [
            //     'Slow query',
            //     'Error'
            // ],
            // EngineVersion: EngineVersion,
            // OptionGroupName: 'default:aurora-5-6',
            DBParameterGroupName: 'mariadb-sl-v1',
            Tags: [
                {
                    Key: 'sl-environment',
                    Value: event['sl-target-environment']
                }
            ],
            VpcSecurityGroupIds: [
                'sg-0758e6e0ea5404ab9'
            ],
            EnableIAMDatabaseAuthentication: false
        };
        rds.restoreDBInstanceFromDBSnapshot(params, function (err, data) {
            if (err) {
                console.warn(err, err.stack);
                done(err);
            } else {
                console.log("mk1");
                console.log(data);
                if (event['modify-route53'] === 'true') {
                    modifyR53();
                } else {
                    done(null, data);
                }
            }
        });
    };

    let checkSnapshotState = () => {
        let params = {
            DBSnapshotIdentifier: DBSnapshotIdentifier,
            SnapshotType: 'manual'
        };
        rds.describeDBSnapshots(params, function (err, data) {
            if (err) {
                console.warn(err, err.stack);
                done(err);
            } else {
                data.DBSnapshots.forEach((snapshot) => {
                    if (snapshot.DBSnapshotIdentifier === DBSnapshotIdentifier) {
                        if (snapshot.Status === 'available') {
                            bSnapshotting = false;
                        }
                    }
                });
            }
        });
    };

    let initCheck = () => {
        let intvl = setInterval(function () {
            checkSnapshotState();
            if (bSnapshotting === false) {
                clearInterval(intvl);
                restoreSnapshot();
            }
        }, 5000)
    };

    let initSnapshot = () => {
        let params0 = {
            DBInstanceIdentifier: DBInstanceIdentifier,
        };
        rds.describeDBInstances(params0, function (err, data) {
            if (err) {
                console.log(err, err.stack);
                done(err);
            } else {
                console.log(data);
                // console.log(data.DBInstances[0].DBInstanceStatus);
                if (data.DBInstances[0].DBInstanceStatus === 'available') {
                    let params = {
                        DBInstanceIdentifier: DBInstanceIdentifier,
                        DBSnapshotIdentifier: `manual-snapshot-initiated-${timenow}`,
                        Tags: [
                            {
                                Key: 'sl-target-environment',
                                Value: event['sl-target-environment']
                            },
                        ]
                    };
                    rds.createDBSnapshot(params, function (err, data) {
                        if (err) {
                            console.warn(err, err.stack);
                            done(err);
                        } else {
                            console.log(data);
                            strAZ = data.DBSnapshot.AvailabilityZone;
                            DBSnapshotIdentifier = data.DBSnapshot.DBSnapshotIdentifier;
                            bSnapshotting = true;
                            initCheck();
                        }
                    });
                } else {
                    done({
                        "message": "not available"
                    })
                }
            }
        });

    };

    initSnapshot();
};
